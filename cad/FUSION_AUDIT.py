import adsk.core
import adsk.fusion
from pathlib import Path

def run(context):
    design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    root = design.rootComponent
    lines = []
    for i in range(root.occurrences.count):
        occ = root.occurrences.item(i)
        if not occ.component.name.startswith('TRACO V1'):
            continue
        tr = occ.transform2
        box = occ.boundingBox
        lines.append('%s | translation %.1f %.1f %.1f mm | bbox %.1f %.1f %.1f / %.1f %.1f %.1f mm' % (
            occ.component.name,
            tr.translation.x*10, tr.translation.y*10, tr.translation.z*10,
            box.minPoint.x*10, box.minPoint.y*10, box.minPoint.z*10,
            box.maxPoint.x*10, box.maxPoint.y*10, box.maxPoint.z*10))
    Path('/Users/flaviospinelli/Documents/ChatGPT/Robo Desenhista/cad/fusion_audit.txt').write_text('\n'.join(lines))
