- úplně bych zahodil možnost přepínání ˚C / ˚F - je to teď zbytečná komplikace, minimálně následující rok budeme 
  cílit jen na český trh a poté až evropský, na americký možná ani nikdy nedojde a teď by to byla dost komplikace
- definice jednotek je teď v jednom souboru
  * u každé jednotky se definují variables
  * variable může být typu `number`, `select`, `boolean` (hodnota je vždy číselná, u `boolean`u je to 0/1)
  * variable má vlastnost `editable`, pokud je `true` tak tuto hodnotu zobrazuješ jako vstup při zadávání Režimu
    ty které mají `false` tak ty se pouze zobrazují na hlavním dashboardu společně s těmi editovatelnými
    (můžeme zobrazovat třeba teplotu nasávaného a vypouštěného vzduchu)
  * variable má vlastnost `class`, která určuje jakou ikonu classy jsou `power`, `temperature`, `mode` a `other` (neuvedený je `other`)
  * příkazy pro ovládání zůstali stejné jen jsou v hlavním JSONu a jsou v objektu `integration` a nejsou nyní rozdělené
    podle powerCommand, temperatureCommand... je tam prostě jen `read`,`write` a `keepAlive`
  * `integration-type` máme v tuhle chvíli pouze `modbus-tcp` a to znamená, že se ptáš na IP, port a unit ID (stejně jako nyní)
  * hodnoty `unit`, `label` a `options`.`label` jsou typu `object` s parametry `text` a `translate` 
    (např. `{"text": "yes", "translate":true}`) nebo `string` což je identické jako by to bylo `{"text": "nejaky text", "translate":false}`
- ideální příklad jednotky z dalšími parametry můžeš vidět v `xvent.json`
- krásné by bylo, kdybychom každou `variable` byly schopni publikovat jako entitu v HASS
