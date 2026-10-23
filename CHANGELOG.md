# Histórico de versões

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
