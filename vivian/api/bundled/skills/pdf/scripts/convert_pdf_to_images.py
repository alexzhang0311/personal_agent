import sys
from pathlib import Path

import fitz


def convert(pdf_path, output_dir, max_dim=1000):
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    page_count = len(doc)
    try:
        for i, page in enumerate(doc, start=1):
            base_zoom = 200 / 72
            max_page_dim = max(page.rect.width, page.rect.height)
            zoom = min(base_zoom, max_dim / max_page_dim) if max_page_dim else base_zoom
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)

            image_path = output_path / f"page_{i}.png"
            pix.save(str(image_path))
            print(f"Saved page {i} as {image_path} (size: {pix.width}x{pix.height})")
    finally:
        doc.close()

    print(f"Converted {page_count} pages to PNG images")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: convert_pdf_to_images.py [input pdf] [output directory]")
        sys.exit(1)
    pdf_path = sys.argv[1]
    output_directory = sys.argv[2]
    convert(pdf_path, output_directory)
