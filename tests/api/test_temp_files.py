import unittest

from fastapi import HTTPException

from vivian.api.services.temp_files import validate_file_content


class TempFileValidationTests(unittest.TestCase):
    def test_accepts_zip_based_xlsx(self) -> None:
        validate_file_content("report.xlsx", b"PK\x03\x04test-data")

    def test_accepts_ole_based_xls(self) -> None:
        validate_file_content("report.xls", b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1test-data")

    def test_rejects_invalid_xlsx_payload(self) -> None:
        with self.assertRaises(HTTPException) as exc:
            validate_file_content("report.xlsx", b"%TSD-Header-###%not-a-real-xlsx")

        self.assertEqual(exc.exception.status_code, 400)
        self.assertIn("Invalid .xlsx file", exc.exception.detail)


if __name__ == "__main__":
    unittest.main()
