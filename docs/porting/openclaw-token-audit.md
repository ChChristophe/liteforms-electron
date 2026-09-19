# Fiche d'audit — repostage du token OpenClaw local (`POC.md` §7.1)

Règle applicable : `Liteforms-Mobile-Application/PLAN.md` §6.4/§6.5 — toute
reprise doit laisser une trace d'audit. Décision produit du 12/09/2026 :
**supprimer la saisie manuelle du token OpenClaw** en lisant automatiquement
l'installation OpenClaw locale. Le token reste strictement local : jamais
loggué, jamais servi en HTTP, jamais envoyé au Mobile.

## Fichiers touchés

- `electron/openclaw/gatewayToken.ts` — résolveur main process (dépendances
  injectables `env`, `fs` (dont `listDir`), `spawn`, `homedir`, `platform`,
  `timeoutMs`).
- `electron/openclaw/gatewayToken.test.ts` — 28 tests.
- `electron/credentials.ts` — `saveProviderCredential(dir, provider, key)`
  exporté (réutilise l'écriture atomique tmp+rename existante).
- `electron/main.ts` — intégration au boot (`app.whenReady`) juste après
  `registerCredentialIpc`, écrite dans `<userData>/config/provider-credentials.json`
  sous la clé `openclaw`.

## Ordre de résolution retenu

1. `process.env.OPENCLAW_GATEWAY_TOKEN` (non vide).
2. CLI `openclaw config get gateway.auth.token` (spawn sans `shell:true`,
   timeout 5 s, stdout trim).
3. Fichiers env puis **définitions de service** (unités systemd user + drop-ins
   Linux, script de tâche `gateway.cmd` Windows) puis bloc `env` de la config →
   `OPENCLAW_GATEWAY_TOKEN`. Une valeur portée par le service prime sur un
   `gateway.auth.token` littéral résolu à l'étape suivante.
4. Littéral `gateway.auth.token` de la config, précédé du contrôle
   `gateway.auth.mode` (`password` / `none` / `trusted-proxy` → pas de token).

Toute erreur (fichier absent/illisible, répertoire non listable, JSON/JSON5 KO,
binaire absent, spawn KO, timeout) ou toute valeur non exploitable → `null`,
sans jamais jeter.

### Constat terrain important : le CLI masque les secrets

Vérifié sur **OpenClaw 2026.7.1-2** installé localement :
`openclaw config get gateway.auth.token` sort le sentinelle
`__OPENCLAW_REDACTED__` (constante `REDACTED_SENTINEL` de
`dist/redact-snapshot-*.js`), **pas** la valeur. Le CLI ne peut donc pas être
la source du token en v2026.7.1-2 : le résolveur traite explicitement cette
sentinelle comme « absent » (`usableToken`) et retombe sur les fichiers.
Test dédié : « treats the CLI redaction sentinel as absent and falls back ».

## Chemins par OS (réels, retenus)

- Config (dans l'ordre) : `$OPENCLAW_CONFIG_PATH` (avec `~` étendu),
  `$OPENCLAW_STATE_DIR/openclaw.json`, `~/.openclaw/openclaw.json`, plus les
  variantes tolérantes `openclaw.json5` / `openclaw.jsonc`.
- Fichiers env : `~/.openclaw/.env`, `~/.openclaw/gateway.systemd.env`,
  `$OPENCLAW_STATE_DIR/.env`, `$OPENCLAW_STATE_DIR/gateway.systemd.env`,
  `~/.config/openclaw/gateway.env` (format `KEY=VALUE`, `export`, quotes).
- Définitions de service (appliance headless, lues en best-effort) :
  - **Linux systemd user** : `~/.config/systemd/user/openclaw-gateway*.service`
    et les drop-ins `~/.config/systemd/user/openclaw-gateway*.service.d/*.conf`.
    Extrait `Environment=OPENCLAW_GATEWAY_TOKEN=<valeur>` (inline, valeur
    quotée gérée) puis `EnvironmentFile=<chemin>` (préfixe optionnel `-`,
    specifier `%h` → home, format `.env`). Seuls les chemins **absolus confinés
    au home ou à `$OPENCLAW_STATE_DIR`** sont lus ; tout autre chemin (ex.
    `/etc/openclaw/gateway.env`) est ignoré.
  - **Windows** : `$OPENCLAW_STATE_DIR/gateway.cmd` puis
    `~/.openclaw/gateway.cmd` ; extrait `set OPENCLAW_GATEWAY_TOKEN=<valeur>`
    ou `set "OPENCLAW_GATEWAY_TOKEN=<valeur>"`.
- `~` = `homedir()` : Windows `C:\Users\<user>\.openclaw\openclaw.json`
  (les tests injectent `C:\Users\x` et vérifient le chemin exact), Linux
  `/home/<user>/.openclaw/openclaw.json`.
- Binaire CLI : d'abord les répertoires de `$PATH`, puis les replis
  Windows (`%APPDATA%\npm\openclaw.cmd`, `%ProgramFiles%\openclaw\openclaw.cmd`)
  et Linux (`/usr/local/bin`, `/usr/bin`, `~/.local/bin`, `~/.npm-global/bin`).
  Sur Windows un `.cmd` ne peut pas être spawn directement (`EINVAL`) : spawn
  `cmd.exe /d /s /c "…"` avec `windowsVerbatimArguments` (arguments figés,
  aucune injection). Le nvm Linux n'est couvert que si `$PATH` l'expose.

## Garde-fous

- Le token n'apparaît dans **aucune** ligne de diagnostic : `main.ts` ne loggue
  que la source (`env` / `cli` / `env-file` / `config`) ou un échec générique.
- La sentinelle de redaction est rejetée avant toute persistance.
- Aucune nouvelle route HTTP : le Mobile continue de ne voir que `configured`
  + masque via `/api/provider-status` (`maskProviderKey` → `***`).
- Écriture réutilisant le store existant : fusion avec les autres providers,
  remplacement d'une valeur manuelle périmée, tmp+rename atomique.
- Vérifié : `diagnosticRedact` n'a pas été touché et aucune ligne du nouveau
  code ne contient le token.
- Lecture des unités systemd / `gateway.cmd` strictement best-effort : `listDir`
  injectable tolérant (`readdirSync` par défaut, `null` sur erreur), fonction
  appelée dans le `try/catch` global → jamais de throw, jamais de log du secret.
- Confinement : un `EnvironmentFile` n'est lu que si, après normalisation
  (`path.normalize`), il reste sous le home ou `$OPENCLAW_STATE_DIR` ; un
  `..` qui s'échappe ou un chemin `/etc/...` est ignoré.

## Limites assumées

- CLI masqué en 2026.7.1-2 → source réelle = fichiers ; le CLI reste en place
  pour les versions qui n'appliquent pas la redaction.
- Extraction JSON5 **ciblée** (pas de dépendance ajoutée) : `stripComments` +
  matching d'accolades + scalaires. Heuristique : premier bloc `gateway`/`auth`
  rencontré ; suffisant pour la forme `openclaw.json`, non garanti pour un
  JSON5 exotique (chaînes multi-lignes, `$include` non suivis).
- Pas de scan des répertoires nvm.
- Unités systemd : seul le répertoire `~/.config/systemd/user` est listé. Une
  unité non **listable** (permissions, emplacement système `/etc/systemd/...`,
  symlink vers un autre chemin) n'est pas trouvée ; les drop-ins ne sont
  parcourus que pour les unités `openclaw-gateway*.service` déjà présentes dans
  ce répertoire. Aucun suivi des symlinks, aucun autre specifier que `%h`.
- `Environment=` : extraction ciblée de la clé `OPENCLAW_GATEWAY_TOKEN=` dans la
  directive ; une valeur non quotée contenant des espaces est tronquée au
  premier espace.
- `gateway.cmd` : recherche ligne à ligne `set …`, pas d'évaluation shell.
- Le token est relu à chaque démarrage ; pas de relecture à chaud.

## Tests (28, verts)

Ordre (`env` prioritaire, CLI, env files, config), CLI Windows `.cmd` +
`windowsVerbatimArguments`, spawn direct Linux, échec CLI, timeout + `kill`,
bloc `env` de la config, SecretRef `${OPENCLAW_GATEWAY_TOKEN}` depuis
`~/.openclaw/.env`, SecretRef d'une autre variable, sentinelle CLI, modes sans
token, config malformée, `$OPENCLAW_CONFIG_PATH`/`$OPENCLAW_STATE_DIR`,
chemin Windows exact, absence de log du secret, non-jet sur spawn/fs en échec.

Ajouts (extension service, 12 tests) : `Environment=` inline d'une unité
systemd ; drop-in `.conf` ; `EnvironmentFile=%h/.openclaw/...` (résolu +
confiné) ; `EnvironmentFile` hors home → ignoré (résultat `null`) ; une unité
prime sur le littéral `gateway.auth.token` ; `~/.openclaw/gateway.systemd.env` ;
`$OPENCLAW_STATE_DIR/gateway.systemd.env` ; `gateway.cmd` `set` et
`set "..."` ; priorité du `gateway.cmd` du state dir ; fallback inchangé vers la
config ; `null` sans artefact.

## Validation runtime (machine Windows, OpenClaw installé)

- `resolveOpenClawGatewayToken()` réel → `source=config`, token 48 chars
  (le CLI renvoie la sentinelle, correctement ignorée).
- `saveProviderCredential` → `openclaw` configuré, remplace une valeur manuelle
  périmée, conserve les autres providers, format `{version:1,credentials}`.
