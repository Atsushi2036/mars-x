from pathlib import Path

from marsx.contracts.export import export

if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[4]
    for p in export(repo / "packages" / "schemas"):
        print(p)
