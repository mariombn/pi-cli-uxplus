# Pi CLI UX+

Workspace de três colunas para o Pi: navegador de arquivos e informações do projeto à esquerda, chat nativo no centro, sessões e monitor de subagentes à direita.

**Versão inicial · testado com Pi 1.4.0 · exige fullscreen.** A interface está em português brasileiro.

## Instalar

```bash
pi install git:github.com/mariombn/pi-cli-uxplus
```

Reinicie o Pi ou execute `/reload`. Para fixar a versão:

```bash
pi install git:github.com/mariombn/pi-cli-uxplus@v0.1.2
```

Use `pi --tui-mode fullscreen`.

Se você usa a versão pessoal antiga `session-sidebar`, mova sua pasta para fora de `~/.pi/agent/extensions/` antes de instalar o pacote. Não carregue as duas cópias simultaneamente.

## Controles

- **Alt+N:** navegador ↔ prompt.
- **Alt+S:** sessões ↔ prompt.
- **Alt+A:** subagentes ↔ prompt.
- **Alt+1 / Alt+3:** mostrar/ocultar laterais.
- **Esc:** voltar ao prompt; na prévia/diálogo, retornar à origem.

No navegador: setas navegam/expandem, Enter em arquivo copia o caminho relativo e volta ao prompt, Enter em pasta expande/recolhe, C copia arquivo/pasta, Espaço abre prévia, R renomeia, Delete inicia a exclusão confirmada, / busca, . mostra arquivos ocultos.

Nas sessões: Enter abre, R renomeia, Delete exclui com confirmação. A sessão atual é marcada com ● e não pode ser excluída antes de abrir outra.

No monitor: setas selecionam e Enter abre detalhes. A integração com `pi-subagents` é opcional e acompanha eventos recebidos após a ativação, sem reconstruir execuções anteriores ao `/reload`.

## Recuperação

`/workspace-off` restaura o layout nativo. `/reload` reativa. `/workspace` mostra ajuda.

## Limitações e segurança

- Apenas Pi 1.4.0 foi validado. Há um adaptador interno de layout isolado em `layout.ts`; atualizações do Pi exigem novos testes.
- Lixeira usa `gio trash` no Linux. Falhas nunca viram exclusão permanente automaticamente.
- Exclusão definitiva exige confirmação extra; pastas não vazias exigem digitar seu nome.
- Operações ficam restritas à raiz; links externos não são percorridos. Evite escritores concorrentes nos mesmos arquivos.
- Renomear não atualiza imports. A verificação de destino existente e o rename não são uma transação atômica.
- Prévia não envia conteúdo ao modelo. Copiar não cola nem envia o prompt.
- A busca tem limites defensivos e não implementa `.gitignore` completo.
- `AGENTS.md`/`CLAUDE.md` são detectados na raiz: existência não significa instruções carregadas.
- Informações excedentes podem ser recortadas em terminais baixos.

## Desenvolvimento

```bash
npm ci
npm test
npm run test:terminal
```

Os testes de terminal usam Pi real em pseudoterminal Linux, sem enviar prompt ao modelo. O teste de monitor usa eventos simulados, sem iniciar subagentes reais.

Documentação completa, arquitetura, instalação e contribuição: [README em inglês](README.md).

Licença [MIT](LICENSE).
