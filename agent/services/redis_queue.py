"""Redis queue — overflow queue for when all accounts/profiles are busy."""
import asyncio
import json
import logging
import time
from typing import Optional
from urllib.parse import urlparse

from agent.config import REDIS_URL

logger = logging.getLogger(__name__)

_redis = None
_connected = False
_last_attempt = 0.0
_RETRY_COOLDOWN = 300  # seconds between reconnection attempts after failure


def _connection_url() -> str:
    """Use TLS for hosted Upstash Redis endpoints."""
    parsed = urlparse(REDIS_URL)
    if parsed.scheme == "redis" and (parsed.hostname or "").endswith(".upstash.io"):
        return "rediss://" + REDIS_URL[len("redis://"):]
    return REDIS_URL


async def _get_redis():
    """Get or create the Redis connection."""
    global _redis, _connected, _last_attempt
    if _redis is None:
        # Don't retry too frequently after failure
        now = time.time()
        if _last_attempt > 0 and now - _last_attempt < _RETRY_COOLDOWN:
            return None
        _last_attempt = now
        try:
            import redis.asyncio as aioredis
            _redis = aioredis.from_url(
                _connection_url(),
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            # Test connection
            await _redis.ping()
            _connected = True
            logger.info("Redis connected: %s", REDIS_URL.split("@")[-1] if "@" in REDIS_URL else REDIS_URL)
        except Exception as e:
            _connected = False
            _redis = None
            if _last_attempt == now:
                logger.warning("Redis connection failed (retry in %ds): %s", _RETRY_COOLDOWN, e)
    return _redis


async def is_available() -> bool:
    """Check if Redis is available."""
    r = await _get_redis()
    return r is not None and _connected


async def enqueue(request_id: str, model: str, priority: int = 0) -> int:
    """Add a request to the model-specific queue.

    Args:
        request_id: The request ID to enqueue
        model: The model name (e.g., "NARWHAL", "GEM_PIX_2")
        priority: Higher = processed first (default 0)

    Returns:
        Position in queue (1-indexed)
    """
    r = await _get_redis()
    if not r:
        logger.warning("Redis unavailable, cannot enqueue request %s", request_id)
        return -1

    queue_key = f"queue:{model}"
    entry = json.dumps({
        "request_id": request_id,
        "model": model,
        "enqueued_at": time.time(),
        "priority": priority,
    })

    # ZPOPMIN removes the lowest score: negate priority, then preserve FIFO.
    score = -priority + time.time() / 1e10
    await r.zadd(queue_key, {entry: score})

    position = await r.zcard(queue_key)
    logger.info("Enqueued request %s for model %s (position: %d)", request_id[:8], model, position)
    return position


async def dequeue(model: str) -> Optional[dict]:
    """Get the next request from the model-specific queue.

    Returns:
        dict with request_id, model, enqueued_at, priority or None if empty
    """
    r = await _get_redis()
    if not r:
        return None

    queue_key = f"queue:{model}"

    # Get and remove the item with lowest score (highest priority, then oldest)
    result = await r.zpopmin(queue_key, count=1)
    if not result:
        return None

    entry_str, _score = result[0]
    entry = json.loads(entry_str)
    logger.info("Dequeued request %s for model %s", entry["request_id"][:8], model)
    return entry


async def peek(model: str, limit: int = 10) -> list[dict]:
    """ peek at the queue without removing items.

    Returns list of entries sorted by priority.
    """
    r = await _get_redis()
    if not r:
        return []

    queue_key = f"queue:{model}"
    items = await r.zrange(queue_key, 0, limit - 1, withscores=True)
    result = []
    for entry_str, score in items:
        entry = json.loads(entry_str)
        entry["score"] = score
        result.append(entry)
    return result


async def get_position(request_id: str, model: str) -> int:
    """Get the position of a request in the queue (1-indexed, -1 if not found)."""
    r = await _get_redis()
    if not r:
        return -1

    queue_key = f"queue:{model}"
    items = await r.zrange(queue_key, 0, -1)
    for i, entry_str in enumerate(items):
        entry = json.loads(entry_str)
        if entry["request_id"] == request_id:
            return i + 1
    return -1


async def remove(request_id: str, model: str) -> bool:
    """Remove a specific request from the queue."""
    r = await _get_redis()
    if not r:
        return False

    queue_key = f"queue:{model}"
    items = await r.zrange(queue_key, 0, -1)
    for entry_str in items:
        entry = json.loads(entry_str)
        if entry["request_id"] == request_id:
            await r.zrem(queue_key, entry_str)
            return True
    return False


async def queue_size(model: str = None) -> dict[str, int] | int:
    """Get queue size(s). If model is specified, return that queue's size.
    Otherwise return dict of all model queue sizes.
    """
    r = await _get_redis()
    if not r:
        return {} if model is None else 0

    if model:
        return await r.zcard(f"queue:{model}")

    # Get all queue sizes
    result = {}
    cursor = 0
    while True:
        cursor, keys = await r.scan(cursor, match="queue:*", count=100)
        for key in keys:
            model_name = key.replace("queue:", "")
            size = await r.zcard(key)
            if size > 0:
                result[model_name] = size
        if cursor == 0:
            break
    return result


async def requeue_front(request_id: str, model: str):
    """Put a request back at the front of the queue (highest priority)."""
    r = await _get_redis()
    if not r:
        return

    queue_key = f"queue:{model}"
    entry = json.dumps({
        "request_id": request_id,
        "model": model,
        "enqueued_at": time.time(),
        "priority": 1000,  # High priority for requeued items
    })
    await r.zadd(queue_key, {entry: -1000 + time.time() / 1e10})


async def cleanup():
    """Close Redis connection."""
    global _redis, _connected
    if _redis:
        await _redis.close()
        _redis = None
        _connected = False
        logger.info("Redis connection closed")
