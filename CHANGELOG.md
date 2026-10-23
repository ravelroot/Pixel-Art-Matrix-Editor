# Histórico de versões

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
