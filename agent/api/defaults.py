"""Default model configuration API — per-operation-type model defaults."""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from agent.db.schema import get_db

router = APIRouter(prefix="/defaults", tags=["defaults"])
logger = logging.getLogger(__name__)

# Hardcoded fallbacks (used if DB has no row)
_FALLBACKS = {
    "generate_image": "NANO_BANANA_2",
    "edit_image": "NANO_BANANA_2",
    "generate_video": "veo_3_1_i2v_lite_low_priority",
    "generate_video_refs": "veo_3_1_r2v_fast_landscape_ultra_relaxed",
    "upscale_video": "veo_3_1_upsampler_4k",
}


async def get_default_model(operation_type: str) -> str:
    """Get the default model value for an operation type from the database.

    Falls back to hardcoded defaults if the row doesn't exist.
    """
    db = await get_db()
    cursor = await db.execute(
        "SELECT model_value FROM default_model WHERE operation_type = ?",
        (operation_type,),
    )
    row = await cursor.fetchone()
    if row:
        return row[0]
    return _FALLBACKS.get(operation_type, "")


async def get_all_defaults() -> dict[str, str]:
    """Get all default models as {operation_type: model_value}."""
    db = await get_db()
    cursor = await db.execute("SELECT operation_type, model_value FROM default_model")
    rows = await cursor.fetchall()
    return {row[0]: row[1] for row in rows}


class DefaultModelUpdate(BaseModel):
    model_value: str


@router.get("")
async def list_defaults():
    """List all default models."""
    defaults = await get_all_defaults()
    # Include fallbacks for any missing operation types
    for op, fallback in _FALLBACKS.items():
        if op not in defaults:
            defaults[op] = fallback
    return defaults


@router.get("/{operation_type}")
async def get_default(operation_type: str):
    """Get the default model for a specific operation type."""
    value = await get_default_model(operation_type)
    if not value:
        raise HTTPException(404, f"No default model for '{operation_type}'")
    return {"operation_type": operation_type, "model_value": value}


@router.put("/{operation_type}")
async def set_default(operation_type: str, body: DefaultModelUpdate):
    """Create or update the default model for an operation type."""
    db = await get_db()
    await db.execute(
        """INSERT INTO default_model (operation_type, model_value, updated_at)
           VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
           ON CONFLICT(operation_type) DO UPDATE SET
             model_value = excluded.model_value,
             updated_at = excluded.updated_at""",
        (operation_type, body.model_value),
    )
    await db.commit()
    logger.info("Default model set: %s = %s", operation_type, body.model_value)
    return {"operation_type": operation_type, "model_value": body.model_value}


@router.delete("/{operation_type}")
async def delete_default(operation_type: str):
    """Delete a default model (reverts to hardcoded fallback)."""
    db = await get_db()
    await db.execute("DELETE FROM default_model WHERE operation_type = ?", (operation_type,))
    await db.commit()
    fallback = _FALLBACKS.get(operation_type, "")
    logger.info("Default model deleted: %s (fallback: %s)", operation_type, fallback)
    return {"operation_type": operation_type, "model_value": fallback, "source": "fallback"}
