"""Export a portable copy of the current TRAÇO V1 Fusion design."""
from pathlib import Path
import traceback
import adsk.core
import adsk.fusion

OUT = Path('/Users/flaviospinelli/Documents/ChatGPT/Robo Desenhista/cad')


def run(context):
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct)
        target = OUT / 'TRACO_V1_MONTAGEM.f3d'
        manager = design.exportManager
        options = manager.createFusionArchiveExportOptions(str(target), design.rootComponent)
        if not manager.execute(options):
            raise RuntimeError('Fusion returned false while exporting archive')
        (OUT / 'fusion_export.log').write_text(f'OK: {target} ({target.stat().st_size} bytes)\n')
    except Exception:
        (OUT / 'fusion_export.log').write_text(traceback.format_exc())
