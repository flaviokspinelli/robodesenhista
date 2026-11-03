"""Read-only overlap check for the printed parts in the displayed assembly pose."""
from pathlib import Path
import traceback
import adsk.core
import adsk.fusion

OUT = Path('/Users/flaviospinelli/Documents/ChatGPT/Robo Desenhista/cad/fusion_interference.log')


def run(context):
    try:
        design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
        items = adsk.core.ObjectCollection.create()
        for i in range(design.rootComponent.occurrences.count):
            occ = design.rootComponent.occurrences.item(i)
            if occ.component.name.startswith('TRACO V1 ') and ' REF ' not in occ.component.name:
                items.add(occ)
        query = design.createInterferenceInput(items)
        query.areCoincidentFacesIncluded = False
        results = design.analyzeInterference(query)
        lines = [f'{items.count} printable occurrences; {results.count} overlaps']
        for result in results:
            a = result.entityOne.parentComponent.name
            b = result.entityTwo.parentComponent.name
            lines.append(f'{a} | {b} | {result.interferenceBody.volume:.5f} cm3')
        OUT.write_text('\n'.join(lines) + '\n')
    except Exception:
        OUT.write_text(traceback.format_exc())
