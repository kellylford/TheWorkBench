"""Double-click launcher (pythonw: no console window)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from theclaudehub.app import main  # noqa: E402

sys.exit(main())
