from pathlib import Path
import traceback
import adsk.core
import adsk.fusion

OUT = Path('/Users/flaviospinelli/Documents/ChatGPT/Robo Desenhista/cad/fusion_color_audit.log')


def run(context):
    try:
        design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
        lines=[]
        for i in range(design.appearances.count):
            a=design.appearances.item(i)
            if a.name.startswith('TRACO'):
                c=a.color
                lines.append(f'{a.name}: {c.red},{c.green},{c.blue},{c.opacity}')
        for i in range(design.rootComponent.occurrences.count):
            c=design.rootComponent.occurrences.item(i).component
            if c.name.startswith('TRACO V1'):
                b=c.bRepBodies.item(0)
                lines.append(f'{c.name}: {b.appearance.name} / {b.appearanceSourceType}')
        OUT.write_text('\n'.join(lines))
    except Exception:
        OUT.write_text(traceback.format_exc())
