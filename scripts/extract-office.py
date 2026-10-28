"""Read bounded Office XML; never execute macros or calculate formulas."""
import sys,zipfile,json,xml.etree.ElementTree as ET
p=sys.argv[1]; ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(p) as z:
 if sum(i.file_size for i in z.infolist())>80*1024*1024:raise ValueError('Office 解压后超过 80 MB 限制')
 if p.lower().endswith('.docx'):
  root=ET.fromstring(z.read('word/document.xml'));text='\n'.join(''.join(e.itertext()) for e in root.findall('.//w:p',ns))
 else:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
  out=[]
  for name in sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')):
   out.append('## '+name)
   for row in ET.fromstring(z.read(name)).findall('.//s:row',ns):
    vals=[]
    for c in row.findall('s:c',ns):
     v=c.find('s:v',ns);s=v.text if v is not None else ''.join(c.itertext())
     if c.attrib.get('t')=='s':s=strings[int(s)] if s and int(s)<len(strings) else s
     vals.append(c.attrib.get('r','')+': '+str(s or ''))
    out.append(' | '.join(vals))
   if sum(len(x) for x in out)>220000:break
  text='\n'.join(out)
print(json.dumps({'text':text[:220000],'truncated':len(text)>220000},ensure_ascii=False))
