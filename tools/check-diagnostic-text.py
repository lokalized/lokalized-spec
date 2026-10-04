#!/usr/bin/env python3
from pathlib import Path
import json
from diagnostic_text.contract import check
print(json.dumps(check(Path(__file__).resolve().parents[1]/'generated/diagnostic-text/v1.1.json')))
