"""Apply the TRAÇO V1 white and graphite prototype finish in open Fusion design."""
from pathlib import Path
import traceback
import adsk.core
import adsk.fusion

LOG = Path('/Users/flaviospinelli/Documents/ChatGPT/Robo Desenhista/cad/fusion_style.log')

def run(context):
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct)
        looks = {}
        for name, rgba in (
            ('TRACO branco acetinado', (237, 239, 236, 255)),
            ('TRACO grafite', (35, 39, 43, 255)),
            ('TRACO metal', (118, 125, 131, 255)),
        ):
            look = design.appearances.itemByName(name)
            if not look:
                look = design.appearances.add(name)
            look.color = adsk.core.Color.create(*rgba)
            look.roughness = 0.52
            looks[name] = look
        root = design.rootComponent
        count = 0
        for i in range(root.occurrences.count):
            comp = root.occurrences.item(i).component
            name = comp.name.lower()
            if not name.startswith('traco v1'):
                continue
            if any(term in name for term in ('carenagem', 'tampa correia', 'cabeca vertical')):
                look = looks['TRACO branco acetinado']
            elif any(term in name for term in ('ref motor', 'ref polia', 'ref eixo')):
                look = looks['TRACO metal']
            else:
                look = looks['TRACO grafite']
            for j in range(comp.bRepBodies.count):
                comp.bRepBodies.item(j).appearance = look
                count += 1
        app.activeViewport.refresh()
        LOG.write_text('OK: %d solids colored\n' % count)
    except:
        LOG.write_text(traceback.format_exc())
