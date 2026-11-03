# TRAÇO — protótipo do quiosque

Interface React + TypeScript em formato vertical `9:16` para o robô desenhista.

## Executar

```bash
npm install
cp .env.example .env.local
# edite .env.local e informe OPENAI_API_KEY
npm run dev
```

Abra `http://localhost:5173` e use o navegador em tela cheia.

## Compilar

```bash
npm run build
```

O resultado de produção é criado em `dist/`.

## Estrutura semântica

- ações visíveis usam elementos `button`;
- estilos usam `input type="radio"` dentro de `fieldset`;
- envio de foto usa `input type="file"`;
- progresso usa o elemento `progress`;
- títulos e mensagens são texto HTML;
- imagens são usadas somente para o mascote, foto e ilustrações.

## Fluxo do desenho

1. A foto é enviada ao backend local.
2. O backend usa a Image API da OpenAI para criar um retrato de linhas.
3. O backend lê diretamente o PNG, extrai as linhas centrais e calcula passadas
   internas para as áreas pretas, usando a largura configurada da caneta.
4. Os trajetos cabem na área útil do papel A4 e viram G-code. O SVG de
   trajetos é reconstruído do mesmo G-code para conferir o resultado.
5. A tela simula os movimentos de desenho do arquivo G-code.

Em desenvolvimento, a tela de prévia permite baixar `retrato.svg` e
`retrato.gcode`. A configuração atual usa `M3 S0` para baixar a caneta e
`M3 S90` para levantá-la; esses comandos devem ser calibrados para o servo e o
firmware do robô real.

A câmera e a geração de arquivos funcionam no protótipo. O envio serial do
G-code ao controlador do robô e o QR Code continuam pendentes do hardware.

## Braço robótico

O modelo TRAÇO V1 no Fusion, os 29 STL para PETG, a lista de componentes, a
ordem de montagem e o conversor de trajetórias estão em [`cad/README.md`](cad/README.md).
Esta é uma versão de protótipo para validação física, ainda não homologada para
uso em festas.
