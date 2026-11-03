#!/usr/bin/env python3
"""Confere fechamento e encaixe individual dos STL na mesa da Ender 3 V3 SE."""

import collections
import csv
import math
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
BED = 220.0


def inspect(path: Path):
    data = path.read_bytes()
    if len(data) < 84:
        raise ValueError(f'{path.name}: arquivo curto')
    triangles = struct.unpack_from('<I', data, 80)[0]
    if len(data) != 84 + triangles * 50:
        raise ValueError(f'{path.name}: tamanho inválido')
    vertices = []
    edges = collections.Counter()
    for i in range(triangles):
        vals = struct.unpack_from('<12fH', data, 84 + 50 * i)
        points = [tuple(round(c, 5) for c in vals[j:j + 3]) for j in (3, 6, 9)]
        vertices.extend(points)
        for j in range(3):
            edges[tuple(sorted((points[j], points[(j + 1) % 3])))]+=1
    extent = [max(v[j] for v in vertices) - min(v[j] for v in vertices) for j in range(3)]
    best = None
    for degree in range(90):
        angle = math.radians(degree)
        ca, sa = math.cos(angle), math.sin(angle)
        xy = [(v[0] * ca - v[1] * sa, v[0] * sa + v[1] * ca) for v in vertices]
        dx = max(p[0] for p in xy) - min(p[0] for p in xy)
        dy = max(p[1] for p in xy) - min(p[1] for p in xy)
        score = max(dx, dy)
        if best is None or score < best[0]:
            best = score, degree, dx, dy
    bad_edges = sum(count != 2 for count in edges.values())
    return triangles, extent, best, bad_edges


def main():
    paths = sorted((HERE / 'stl').glob('*.stl'))
    if not paths:
        raise RuntimeError('nenhum STL encontrado')
    with (HERE / 'validacao_stl.csv').open('w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(('arquivo', 'triangulos', 'X_mm', 'Y_mm', 'Z_mm',
                         'rotacao_graus', 'mesa_X_mm', 'mesa_Y_mm',
                         'arestas_nao_fechadas', 'cabe_em_220'))
        for path in paths:
            triangles, extent, best, bad_edges = inspect(path)
            _, degree, dx, dy = best
            writer.writerow((path.name, triangles, *(f'{v:.2f}' for v in extent),
                             degree, f'{dx:.2f}', f'{dy:.2f}', bad_edges,
                             dx <= BED and dy <= BED))
            if bad_edges or dx > BED or dy > BED:
                raise RuntimeError(f'{path.name}: malha ou dimensões inválidas')
    print(f'{len(paths)} STL fechados e dentro da mesa {BED:.0f} × {BED:.0f} mm')


if __name__ == '__main__':
    main()
