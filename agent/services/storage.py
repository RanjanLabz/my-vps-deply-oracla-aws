"""Cloudflare R2 storage service."""
import io
import mimetypes
import uuid
from pathlib import Path
from typing import Optional

import boto3
import httpx
import logging

from agent.config import (
    R2_ACCESS_KEY_ID,
    R2_BUCKET_NAME,
    R2_ENDPOINT_URL,
    R2_PUBLIC_URL,
    R2_SECRET_ACCESS_KEY,
)

logger = logging.getLogger(__name__)


class R2Storage:
    """Cloudflare R2 storage client using S3-compatible API."""

    def __init__(self):
        self.s3 = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
        self.bucket = R2_BUCKET_NAME
        self.public_url = R2_PUBLIC_URL

    def upload_bytes(self, data: bytes, key: str, content_type: str = "image/jpeg") -> str:
        """Upload bytes to R2. Returns public URL."""
        self.s3.upload_fileobj(
            io.BytesIO(data),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        url = f"{self.public_url}/{key}"
        logger.info("R2 upload: %s (%d bytes)", key, len(data))
        return url

    def upload_file(self, file_path: Path, key: str) -> str:
        """Upload a local file to R2. Returns public URL."""
        content_type, _ = mimetypes.guess_type(str(file_path))
        if not content_type:
            content_type = "application/octet-stream"

        with open(file_path, "rb") as f:
            self.s3.upload_fileobj(
                f,
                self.bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            )
        url = f"{self.public_url}/{key}"
        logger.info("R2 upload: %s", key)
        return url

    def upload_from_url(self, source_url: str, key: str, content_type: Optional[str] = None) -> Optional[str]:
        """Download from URL and upload to R2. Returns public URL or None."""
        try:
            with httpx.Client(timeout=60, follow_redirects=True) as client:
                resp = client.get(source_url)
                resp.raise_for_status()
                data = resp.content

            if not content_type:
                content_type = resp.headers.get("content-type", "")
                if not content_type or content_type == "application/octet-stream":
                    content_type, _ = mimetypes.guess_type(source_url)
                    if not content_type:
                        content_type = "image/jpeg"

            return self.upload_bytes(data, key, content_type)

        except Exception as e:
            logger.error("R2 upload failed from %s: %s", source_url[:80], e)
            return None

    def delete_file(self, key: str) -> bool:
        """Delete a file from R2."""
        try:
            self.s3.delete_object(Bucket=self.bucket, Key=key)
            return True
        except Exception as e:
            logger.error("R2 delete failed: %s", e)
            return False


_storage: Optional[R2Storage] = None


def get_storage() -> R2Storage:
    """Get or create the singleton R2Storage instance."""
    global _storage
    if _storage is None:
        _storage = R2Storage()
    return _storage
