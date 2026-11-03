# TRAÇO V1 — braço desenhista de três eixos

Projeto original inspirado na proporção e no contraste visual das referências do cliente: base central compacta, braços grafite aparentes e carenagens brancas removíveis. Não reproduz a forma ou os detalhes de um produto existente.

## Estado da entrega

- O projeto `TRACO_V1_MONTAGEM.f3d` está editável no Fusion e contém 29 componentes para impressão, mais envelopes de motores e polias comprados.
- `stl/` contém os 29 STL individuais. Todos tiveram malha fechada e dimensões de caixa verificadas. Na Ender 3 V3 SE, os braços e a carenagem longa precisam ficar a **45°** na mesa de 220 × 220 mm.
- A montagem no Fusion representa uma pose de apresentação. Ainda não possui juntas cinemáticas configuradas nem foi validada com peças físicas.
- **É um protótipo de engenharia, não um equipamento pronto para locação.** A folga dos encaixes, esforço dos motores, rigidez, interferências, comportamento térmico, eletrônica e proteção do público exigem montagem e ensaios reais.

## Geometria

| Item | Valor nominal |
|---|---:|
| Alcance geométrico máximo no plano do braço | 400 mm |
| Braço superior / antebraço entre eixos | 200 / 200 mm |
| Altura do eixo do ombro sobre bancada | 162 mm |
| Distância vertical nominal do punho à ponta da caneta | 85 mm |
| Base central | 148 × 148 mm |
| Base inteira com aba lateral do motor | 194 × 148 mm |
| Redução sugerida em cada motor | GT2 20T → 100T, 5:1 |
| Papel | A4 retrato, borda próxima 80 mm à frente do eixo da base |

O alcance de 400 mm é o limite matemático com braço esticado. A área útil é menor por causa dos limites articulares e da altura do papel. O G-code atual do quiosque usa margens internas e cabe na área modelada; confirme isso com a caneta suspensa antes de desenhar.

## Peças compradas previstas

| Item | Quantidade | Observação |
|---|---:|---|
| NEMA 17 17HS4401 | 3 | Os motores já disponíveis; eixo 5 mm |
| Polia GT2 20 dentes, furo 5 mm, para correia 6 mm | 3 | Com fixação por parafuso |
| Polia GT2 100 dentes, furo 8 mm, para correia 6 mm | 3 | Aferir largura total do cubo |
| Correia fechada GT2 6 mm | 1 × 280, 1 × 260, 1 × 400 mm | Comprimentos nominais; conferir com as peças e rasgos de ajuste antes da compra final |
| Rolamento 608-2RS, 8 × 22 × 7 mm | 9 | Base 2; ombro 2; cotovelo 3; punho 2 |
| Eixo de aço retificado Ø8 mm | 4 | Cortar pelos empilhamentos reais: base, ombro, cotovelo, punho |
| Cubo para eixo Ø8 mm, padrão Pololu 2693 | 6 | Modelo usa seis furos M3 em círculo Ø19,05 mm |
| Colar de eixo Ø8 mm e arruela de encosto | 8 de cada | Travamento axial de cada eixo |
| Espaçadores metálicos M5, 7, 8, 16, 19 e 21 mm | conforme montagem | Fixações laterais dos motores, âncora e hastes; confirmar empilhamentos reais |
| Parafusos M3, M4, M5, M6, porcas travantes e arruelas | sortimento | Comprimentos dependem dos cubos e espaçadores usados |
| Pinos ou parafusos de ombro Ø5 mm com arruelas PTFE | 4 | Articulações das hastes paralelas; verificar desgaste em serviço |
| Mola de compressão e colar para caneta Ø10 mm | 1 de cada | Dar pequena complacência à ponta |
| Drivers de passo, controlador de três eixos, fonte, fim de curso, botão de emergência | conjunto | Selecionar corrente e tensão pelos componentes efetivamente comprados |

**Conferência essencial:** o motor J3 fica preso ao braço superior, perto do ombro. Seu centro acompanha o braço; assim a distância até o cotovelo permanece 140 mm. A polia de J3 fica no eixo do cotovelo, presa aos antebraços. Não fixar o motor J3 à torre.

Os comprimentos teóricos das correias resultam dos centros nominais: J1 = 75 mm, J2 ≈ 65,5 mm, J3 = 140 mm. Os rasgos nos suportes permitem ajuste, mas a posição real depende do diâmetro efetivo e do perfil dos componentes adquiridos. Antes de comprar três correias fechadas, uma alternativa é testar o comprimento com correia aberta e abraçadeiras.

## Impressão PETG

1. Imprima primeiro **um mancal**, **uma extremidade de braço** e **o porta-caneta** para testar Ø22,15, Ø8,25, Ø5,3, Ø10,8 e a folga com as peças compradas. Ajuste no Fusion se necessário.
2. Fatias de 0,20 mm, 4 a 5 perímetros, 5 camadas de topo/fundo. Para braços, torres, mancais e suportes use 40–50% de preenchimento; as carenagens podem usar 15–20%. Esses valores são ponto de partida para ensaio, não uma resistência certificada.
3. Coloque `10_braco_*`, `11_antebraco_*`, `18_carenagem_*` e `22_tampa_*` a 45° na mesa. Confirme margem de pelo menos 5 mm da borda no fatiador.
4. Rebarbe furos e assentos. Não force rolamentos a ponto de trincar PETG. Use arruelas para não esmagar plástico com o aperto.

## Ordem de montagem prevista

1. Fixe a base numa bancada rígida, fora da área de desenho. Encaixe os dois mancais 608, os retentores e as quatro colunas; instale eixo, polia J1, colares e plataforma giratória.
2. Prenda as duas laterais da torre à plataforma com espaçadores metálicos. Alinhe os mancais do ombro. Monte o eixo do ombro, os braços superiores e a polia J2; os cubos prendem os braços ao eixo.
3. Fixe o motor J2 à lateral esquerda da torre. Fixe o motor J3 **no braço superior esquerdo**, com espaçadores; use os furos do braço próximos das posições de 35 e 85 mm. Os rasgos servem para tensionar as correias.
4. Monte o eixo do cotovelo. Os braços superiores giram livremente no eixo por rolamentos; os antebraços e a polia J3 são fixados ao eixo por cubos. Prenda a âncora da haste superior à torre pelo furo inferior, para que ela permaneça parada enquanto o ombro gira. Instale o balancim e os dois paralelogramos com seus espaçadores, depois a cabeça vertical no eixo do punho.
5. Monte o porta-caneta com pequena liberdade axial e mola. Confira à mão o movimento completo sem motores ligados, com carenagens fora. Adicione carenagens só após eliminar interferências.
6. Ajuste o contrapeso ou mola de alívio do ombro **a partir de medições reais**. Para o NEMA 17 com 5:1, o torque nominal de retenção não representa o torque disponível enquanto move; o braço não deve cair nem perder passos ao desligar ou acelerar.

## Desenhos A4 e eletrônica

`converter_gcode.py` lê o `retrato.gcode` exportado pelo quiosque e gera um arquivo em que X/Y/Z representam, em **graus**, base/ombro/cotovelo. Ele subdivide os traços em trechos de até 2 mm e verifica alcance e limites. `M3 S0` baixa o braço 8 mm; `M3 S90` o eleva. Assim a V1 usa os três NEMA 17 para o desenho e para levantar a caneta.

```bash
python3 cad/converter_gcode.py retrato.gcode cad/retrato_articulado.gcode
```

O arquivo convertido **não deve ser executado diretamente** antes de implementar e calibrar o controlador: zeragem física dos três eixos, passos por grau, sentido de cada motor, fins de curso, limites, desaceleração e teste sem caneta. Em um controlador tipo GRBL, a unidade artificial de cada eixo é 1 grau, portanto a configuração de passos por unidade depende de 200 passos/volta, microstepping e redução real; com 1/16 e 5:1 o valor teórico é `44,444 passos/grau`. A precisão real inclui folga de correia, elasticidade e passos perdidos.

Para locação em festas, o botão de emergência, limites mecânicos, cabos presos, contenção de dedos e teste prolongado de funcionamento são obrigatórios no projeto final. O projeto ainda não os resolve fisicamente.

## Licença do Fusion

O Fusion aberto nesta máquina indica **“Pessoal (para uso não comercial)”**. A Autodesk informa que essa licença se destina a projetos pessoais não comerciais. Confira a licença adequada antes de fabricar o equipamento para aluguel.
