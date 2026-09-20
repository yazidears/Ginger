"""Fix uninitialized local NODE pointer in upstream 2025.0717. No physics changes."""
import sys
from pathlib import Path
p=Path(sys.argv[1])/'build/source/elmfire_level_set.f90'
s=p.read_text()
old='CALL SYSTEM_CLOCK(ITSTART)\nIT1=ITSTART'
new='! Ginger: initialize C before ASSOCIATED(C) in initial-burn setup.\nNULLIFY(C)\nCALL SYSTEM_CLOCK(ITSTART)\nIT1=ITSTART'
if 'Ginger: initialize C' not in s:
 assert s.count(old)==1
 p.write_text(s.replace(old,new))
