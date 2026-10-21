"""Persistent source-ID -> Salesforce-ID maps, one CSV per object under <output_dir>/id-maps."""
import csv
from pathlib import Path


class IdMaps:
    def __init__(self, output_dir):
        self.dir = Path(output_dir) / "id-maps"
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, name):
        return self.dir / f"{name}.csv"

    def load(self, name):
        p = self.path(name)
        if not p.exists():
            return {}
        with p.open(encoding="utf-8", newline="") as f:
            # First column = source ID, last column = Salesforce ID (extra columns are informational).
            return {row[0]: row[-1] for i, row in enumerate(csv.reader(f)) if i > 0 and row}

    def save(self, name, mapping, header):
        with self.path(name).open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(header)
            for k, v in sorted(mapping.items()):
                w.writerow([k, v])
