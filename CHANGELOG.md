# Histórico de versões

## 2.0.0 — 23/10/2026

**Código em inglês:** todo o código foi traduzido do português para o inglês: identificadores, comentários, nomes de arquivos e pastas, rotas e campos da API, chaves do formato `.crivo`, tabelas e colunas do banco, variáveis de ambiente, comandos da linha de comando e scripts do npm. A interface continua em português: menus, diálogos, avisos, mensagens de erro da API e textos da linha de comando não mudaram, e o editor funciona do mesmo jeito. Por ser uma mudança que quebra integrações, a versão passa a 2.0.0. Projetos, arquivos e bancos da 1.x continuam abrindo.

**API (mudança incompatível):** `/api/v1` foi removida. As rotas agora ficam em `/api/v2`, com nomes, parâmetros e campos em inglês: `/api/v2/health`, `/api/v2/projects`, `/api/v2/projects/{id}/thumbnail`, `/export?format=&mode=&frame=all|N&download=1`, `/png?frame=N&scale=N&download=1`, `/revisions` e `/revisions/{number}/restore`, e `/api/v2/palettes` (`?presets=0`). Os corpos usam `name`, `data`, `thumbnail` e `revision`; as paletas, `name` e `colors`. Os erros continuam como `{"error": "mensagem em português"}`, e o conflito 409 traz `current_revision`. Scripts que chamavam a v1 precisam trocar o endereço e os nomes dos campos.

**Formato `.crivo` versão 2:** as chaves passaram para o inglês (`format`, `version`, `name`, `width`, `height`, `palette`, `layers`, `frames`, `cells`…). Arquivos da versão 1 (com chaves em português) continuam abrindo no editor, na API e na ferramenta em Java, e são convertidos na leitura; ao salvar, o Crivo sempre grava a versão 2. Um arquivo de versão maior que 2 é recusado com o aviso de que foi salvo por um Crivo mais novo. O RLE das células não mudou. A exportação de dados da matriz também usa chaves em inglês (`width`, `height`, `mode`, `transparent`, `palette`, `frames`).

**Banco de dados:** a migração `0003_english_schema` renomeia tabelas, colunas, restrições e índices para o inglês (`project`, `layer`, `frame`, `cell`, `revision`, `palette`, `palette_color`) sem copiar nem perder dados. Ao atualizar, rode `python manage.py migrate` (com Docker, as migrações rodam sozinhas ao subir). Versões antigas guardadas no formato 1 são convertidas quando restauradas.

**Variáveis de ambiente:** sete variáveis ganharam nomes em inglês: `CRIVO_TAMANHO_MAXIMO_MB` → `CRIVO_MAX_UPLOAD_MB`, `CRIVO_HSTS_SEGUNDOS` → `CRIVO_HSTS_SECONDS`, `CRIVO_HSTS_SUBDOMINIOS` → `CRIVO_HSTS_SUBDOMAINS`, `CRIVO_REDIRECIONAR_HTTPS` → `CRIVO_HTTPS_REDIRECT`, `CRIVO_MAX_REVISOES` → `CRIVO_MAX_REVISIONS`, `CRIVO_LIMITE_ESCRITAS` → `CRIVO_WRITE_LIMIT` e `CRIVO_PROXY_CONFIAVEL` → `CRIVO_TRUSTED_PROXY`. Os nomes antigos ainda são lidos quando o novo não está definido, mas estão obsoletos: troque-os no seu `.env`. As demais variáveis não mudaram.

**Pastas e arquivos:** `ferramentas/java` → `tools/java`, `exemplos` → `examples` (`heart.crivo`, `game-boy-slime.crivo` e `potion.crivo`, já no formato 2), `iniciar.cmd` e `iniciar.sh` → `start.cmd` e `start.sh`, `editor/static/editor/js/nucleo` → `js/core`, e os scripts `servir.js`, `gerar-portatil.js`, `gerar-desktop.js` e `criar-env.ps1` → `serve.js`, `build-portable.js`, `build-desktop.js` e `create-env.ps1`. Os módulos do editor e do servidor também têm nomes em inglês.

**Scripts do npm:** `npm run servir` → `npm run serve`, `npm run portatil` → `npm run portable` (o `npm run desktop` não mudou) e a opção `--verificar` → `--check`.

**Ferramenta em Java:** comandos `info`, `palette`, `png`, `sheet`, `matrix` e `check`, com as opções `--frame`, `--scale`, `--layout` (`horizontal`, `vertical` ou `grid`), `--columns`, `--spacing`, `--mode` e `--class`. Os comandos e as opções em português (`paleta`, `folha`, `matriz`, `verificar`, `--quadro`, `--escala`, `--disposicao`, `--colunas`, `--espaco`, `--modo`, `--classe`, `todos`, `grade`) continuam funcionando como apelidos. A ajuda e as mensagens seguem em português.

**Dados do editor no navegador:** na primeira abertura da 2.0.0, os projetos e o rascunho guardados no IndexedDB e as preferências e paletas do `localStorage` são migrados sozinhos para os nomes novos, sem perder nada. No app desktop, os dados continuam em `%LOCALAPPDATA%\Crivo`.

**App desktop:** a ponte entre o Go e a página foi renomeada (`window.crivoDesktop`, com `toggleFullscreen()` e `quit()`); o arquivo que registra o atalho do menu Iniciar passa a ser `shortcut.txt` (o `atalho.txt` antigo ainda é lido). Para quem só usa o Crivo, nada muda.

**Testes:** 142 no total: 41 do núcleo do editor, 24 ponta a ponta (incluindo a migração dos dados do navegador da 1.x), 52 da API (incluindo a migração do banco e os arquivos da versão 1) e 25 da ferramenta em Java.

**Documentação:** README, manual técnico e PDF de banco de dados atualizados com os nomes novos.

## 1.2.0 — 23/10/2026

**Três maneiras de rodar:** app desktop para Windows (`Crivo.exe`), servidor local com backend (Django e banco de dados) e arquivo único no navegador (`Crivo.html`). O editor é o mesmo nas três, e os arquivos `.crivo` passam de uma para outra.

**App desktop:** o `Crivo.exe` (cerca de 3 MB, sem instalação) abre o Crivo numa janela própria do Windows 10 e 11, já maximizada. **F11** alterna a tela cheia e **Alt+F4** (ou **Arquivo → Sair do Crivo**) fecha gravando o rascunho antes. Projetos e paletas ficam em `%LOCALAPPDATA%\Crivo`. Na primeira abertura, cria um atalho no menu Iniciar, para o Crivo aparecer na pesquisa do Windows. O ícone é o logo do projeto. Feito em Go com o Microsoft Edge WebView2, que já vem no Windows; roda sem permissão de administrador e sem abrir portas de rede. Gerado por `npm run desktop`, com build reproduzível conferido no CI.

**Arquivo único:** o `Crivo.html` traz o editor inteiro num só arquivo, que abre com dois cliques direto da pasta, sem servidor local, sem backend e sem internet, com Content-Security-Policy própria. Gerado por `npm run portatil` (`scripts/gerar-portatil.js`, sem bibliotecas).

**Editor:** aberto do disco, não tenta procurar a API; no app desktop, ganha **Exibir → Tela cheia**, **Arquivo → Sair do Crivo** e o rótulo **Desktop (este computador)** na barra de status.

**Testes:** 21 testes ponta a ponta (10 com o servidor e 11 no `Crivo.html`, incluindo a integração com o app desktop), 111 no total. O CI confere se o `Crivo.html` e o `Crivo.exe` estão em dia com o código e roda o `go vet`.

**Documentação:** README e manual em PDF mostram as três maneiras de rodar e explicam o app desktop.

## 1.1.0 — 23/10/2026

**Ferramentas novas:** seleção retangular (S), mover pixels (V, com setas), pontilhado com padrão de Bayer (D), degradê pontilhado linear e radial (U) e clarear e escurecer pela rampa da paleta ou pela luminosidade OKLCH (Q).

**Opções novas:** pixel perfect no lápis, pincel de até 32 px, linha forte da grade a cada 4, 8, 16 ou 32 pixels e modo ladrilho (T).

**Comandos novos:** copiar, recortar, colar, apagar seleção, selecionar tudo e desmarcar; espelhar só a seleção (Shift+H e Shift+V); recortar para a seleção, aparar bordas transparentes, deslocar meia matriz (Shift+T), contorno de 4 ou 8 vizinhos, converter para a paleta atual, substituir a cor primária pela secundária em todos os quadros, inverter cores e tons de cinza.

**Exportação:** GIF animado (Ctrl+Shift+G) com transparência, duração de cada quadro e repetição, por um codificador LZW próprio.

**API:** rota `/api/v1/projetos/{id}/png` e formatos `c` e `java` na exportação de dados.

**Segurança:** Content-Security-Policy e demais cabeçalhos de proteção, HSTS com HTTPS, limite de escritas por IP (`CRIVO_LIMITE_ESCRITAS`), recusa de iniciar em produção com chave secreta fraca, JSON aninhado e corpo grande tratados sem erro 500 e escape do rótulo dos ícones.

**Exportação Java:** sprites grandes geram uma classe compacta que compila (a matriz vai em texto, lida ao carregar a classe), no editor, na API e na linha de comando; o arquivo baixado tem o nome da classe. Em C, índices passam a `int32_t` com mais de 32 767 cores.

**Robustez:** colagem flutuante (mover não fura nem arrasta o fundo), atalhos bloqueados durante gestos do mouse, degradê não pinta com um clique, preferências do navegador validadas e limite de escritas contado depois do CSRF e com suporte a proxy confiável (`CRIVO_PROXY_CONFIAVEL`).

**Testes:** 100 testes (40 JavaScript, 39 Django, 11 Java e 10 ponta a ponta com Playwright), Ruff e Bandit no CI.

## 1.0.0

Primeira versão.
