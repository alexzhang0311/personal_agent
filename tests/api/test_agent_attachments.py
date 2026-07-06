import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException

from vivian.api.routers.agent import _validate_attachments


class AgentAttachmentValidationTests(unittest.TestCase):
    def test_allows_files_in_workspace_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            file_path = workspace / "note.txt"
            file_path.write_text("hello", encoding="utf-8")

            result = _validate_attachments(
                [SimpleNamespace(path=str(file_path), name="note.txt")],
                str(workspace),
            )

            self.assertEqual(result, [{"path": str(file_path.resolve()), "name": "note.txt"}])

    def test_allows_uploaded_files_in_temp_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            temp_dir = workspace / "temp"
            temp_dir.mkdir()
            file_path = temp_dir / "upload.pdf"
            file_path.write_bytes(b"%PDF")

            result = _validate_attachments(
                [SimpleNamespace(path=str(file_path), name="upload.pdf")],
                str(workspace),
            )

            self.assertEqual(result, [{"path": str(file_path.resolve()), "name": "upload.pdf"}])

    def test_rejects_files_outside_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as workspace_tmp, tempfile.TemporaryDirectory() as outside_tmp:
            outside_file = Path(outside_tmp) / "secret.txt"
            outside_file.write_text("nope", encoding="utf-8")

            with self.assertRaises(HTTPException) as ctx:
                _validate_attachments(
                    [SimpleNamespace(path=str(outside_file), name="secret.txt")],
                    workspace_tmp,
                )

            self.assertEqual(ctx.exception.status_code, 400)
            self.assertIn("outside workspace", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()
