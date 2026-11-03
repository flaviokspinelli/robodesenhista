#!/usr/bin/env python3
"""Converte o G-code cartesiano do quiosque TRAÇO em trajetórias articulares.

Saída X/Y/Z = graus de base/ombro/cotovelo. É uma ferramenta de preparação,
não envia comandos ao robô. Requer calibração real dos zeros e dos limites.
"""

from __future__ import annotations

import argparse
import math
import re
from pathlib import Path

L1 = L2 = 200.0  # centros dos mancais, mm
SHOULDER_Z = 162.0  # sobre a bancada, mm
PEN_OFFSET_Z = 85.0  # punho até ponta da caneta, mm
PAPER_NEAR_EDGE_R = 80.0  # origem da folha além da base, mm
PEN_UP_MM = 8.0
MAX_SEGMENT_MM = 2.0
JOINT_LIMITS = ((-60.0, 60.0), (0.0, 85.0), (-150.0, -20.0))
NUMBER = r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)'


def joint_angles(paper_x: float, paper_y: float, pen_up: bool) -> tuple[float, float, float]:
    """X do papel é largura; Y vai da base até a borda distante."""
    radial_x = PAPER_NEAR_EDGE_R + paper_y
    lateral_y = paper_x - 105.0
    radius = math.hypot(radial_x, lateral_y)
    wrist_z = PEN_OFFSET_Z + (PEN_UP_MM if pen_up else 0.0)
    height = wrist_z - SHOULDER_Z
    d2 = radius * radius + height * height
    cosine = (d2 - L1 * L1 - L2 * L2) / (2 * L1 * L2)
    if cosine < -1 or cosine > 1:
        raise ValueError(f'fora do alcance em X{paper_x:.2f} Y{paper_y:.2f}')
    # Ramo com cotovelo acima: condiz com a pose montada no Fusion.
    elbow = -math.acos(max(-1.0, min(1.0, cosine)))
    shoulder = math.atan2(height, radius) - math.atan2(L2 * math.sin(elbow), L1 + L2 * math.cos(elbow))
    angles = (math.degrees(math.atan2(lateral_y, radial_x)),
              math.degrees(shoulder), math.degrees(elbow))
    for name, angle, (lo, hi) in zip(('base', 'ombro', 'cotovelo'), angles, JOINT_LIMITS):
        if not lo <= angle <= hi:
            raise ValueError(f'{name} em {angle:.2f}° fora dos limites [{lo}, {hi}] em X{paper_x:.2f} Y{paper_y:.2f}')
    return angles


def axis(line: str, letter: str, old: float) -> float:
    match = re.search(r'\b' + letter + r'\s*(' + NUMBER + r')', line, re.I)
    return float(match.group(1)) if match else old


def format_move(angles: tuple[float, float, float], cartesian_feed: float,
                cartesian_distance: float, previous: tuple[float, float, float] | None) -> str:
    joint_distance = 0.0 if previous is None else math.dist(previous, angles)
    # GRBL interpreta F em unidades articulares/minuto neste arquivo.
    joint_feed = max(10.0, min(180.0, cartesian_feed * joint_distance / max(cartesian_distance, .1)))
    return 'G1 X%.4f Y%.4f Z%.4f F%.2f' % (*angles, joint_feed)


def convert(source: str) -> str:
    x = y = 0.0
    pen_up = True
    previous_angles: tuple[float, float, float] | None = None
    out = [
        '; TRAÇO V1: X=base, Y=ombro, Z=cotovelo, todos em graus',
        '; Simular e calibrar zeros/limites antes de enviar a qualquer controlador',
        'G21', 'G90',
    ]
    seen_move = False
    feed = 1200.0

    for lineno, raw in enumerate(source.splitlines(), 1):
        line = raw.split(';', 1)[0].strip().upper()
        if not line:
            continue
        if re.match(r'^G(?:20|91)\b', line):
            raise ValueError(f'linha {lineno}: somente G21 e G90 são aceitos')
        if re.match(r'^M3\s+S(?:0|90)\b', line):
            new_up = bool(re.search(r'\bS90\b', line))
            if new_up != pen_up:
                new_angles = joint_angles(x, y, new_up)
                out.append(format_move(new_angles, 200.0, PEN_UP_MM, previous_angles))
                previous_angles = new_angles
                pen_up = new_up
            continue
        if re.match(r'^G[01]\b', line):
            nx, ny = axis(line, 'X', x), axis(line, 'Y', y)
            if not (0 <= nx <= 210 and 0 <= ny <= 297):
                raise ValueError(f'linha {lineno}: X/Y fora do papel A4')
            feed = axis(line, 'F', feed)
            travel = math.hypot(nx - x, ny - y)
            count = max(1, math.ceil(travel / MAX_SEGMENT_MM))
            for i in range(1, count + 1):
                tx = x + (nx - x) * i / count
                ty = y + (ny - y) * i / count
                new_angles = joint_angles(tx, ty, pen_up)
                out.append(format_move(new_angles, feed, travel / count, previous_angles))
                previous_angles = new_angles
            x, y = nx, ny
            seen_move = True
            continue
        if re.match(r'^(G(?:21|90)|M2)\b', line):
            continue
        raise ValueError(f'linha {lineno}: comando não suportado: {line}')
    if not seen_move:
        raise ValueError('nenhum movimento G0/G1 encontrado')
    if not pen_up:
        new_angles = joint_angles(x, y, True)
        out.append(format_move(new_angles, 200.0, PEN_UP_MM, previous_angles))
    out.append('M2')
    return '\n'.join(out) + '\n'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('entrada', type=Path, help='retrato.gcode gerado pelo quiosque')
    parser.add_argument('saida', type=Path, help='arquivo de três eixos articulados')
    args = parser.parse_args()
    result = convert(args.entrada.read_text())
    args.saida.write_text(result)
    print(f'{len(result.splitlines())} linhas verificadas em {args.saida}')


if __name__ == '__main__':
    main()
