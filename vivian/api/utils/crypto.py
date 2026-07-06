from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from ..middleware.logging import get_app_logger

logger = get_app_logger(__name__)

ENC_PREFIX = "enc:v1:"
_FERNET = Fernet(b"sbKkbgCHmtelZW8UO56q5q1JF-s4Uqs_qVPRylym1xY=")


def is_encrypted(value: str | None) -> bool:
    return isinstance(value, str) and value.startswith(ENC_PREFIX)


def encrypt_value(plaintext: str | None) -> str | None:
    if plaintext is None:
        return None
    if is_encrypted(plaintext):
        return plaintext
    return ENC_PREFIX + _FERNET.encrypt(plaintext.encode()).decode()


def decrypt_value(stored: str | None) -> str | None:
    if stored is None:
        return None
    if not is_encrypted(stored):
        return stored
    try:
        return _FERNET.decrypt(stored[len(ENC_PREFIX):].encode()).decode()
    except InvalidToken:
        logger.error("Failed to decrypt value: invalid token or corrupt data")
        return None
