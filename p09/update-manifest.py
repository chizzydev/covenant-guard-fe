from pathlib import Path
import hashlib
root=Path(__file__).resolve().parent.parent
skip={'.git','node_modules','results','artifacts','__pycache__'}
rows=[]
for p in root.rglob('*'):
 rel=p.relative_to(root)
 if any(x in skip for x in rel.parts) or not p.is_file() or p.name=='MANIFEST_SHA256.txt' or p.suffix=='.pyc':continue
 rows.append((rel.as_posix(),hashlib.sha256(p.read_bytes()).hexdigest().upper()))
(root/'MANIFEST_SHA256.txt').write_text(''.join(h+'  '+p+'\n' for p,h in sorted(rows)),encoding='utf-8',newline='\n')
print('P09_SOURCE_MANIFEST_FILES='+str(len(rows)))
