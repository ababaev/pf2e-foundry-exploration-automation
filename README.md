# pf2e-foundry-exploration-automation
A set of macros that may boost an experience of exploration activity processes in Foundry's Pathfinder 2e System.

## How To Install / Uninstall

### Install

* check out the repo to your modules folder. The module is not yet registered in Foundry Store.
* enable the module in your World
* in your macros you will find the folder "PF2e Exploration Automation".

In there:

<img src="assets/icons/region-automation-main.png" width="40" alt="Main dialog"> -- Main dialog window to modify the selected region

<img src="assets/icons/region-manual-automation-run.png" width="40" alt="Manual region trigger"> -- trigger all the checks of the selected region

<img src="assets/icons/unregister-region.png" width="40" alt="Unregister tokens from Region"> -- clear the region, so all the tokens can trigger hooks again.

Done.

### Uninstall

* uncheck the module in your World.
* remove the "PF2e Exploration Automation" folder in macros.

Yes, as simple as that.

## How To

### Wording

- Region -- a Foundry entity GM can create using "Region Controls" menu
- Region Behavior -- a trigger added to the tab "Behaviors" of a "Region". It has a name and a type. In case of this module, the type will always be "Execute Script", and will be subscribed to specific events automatically, and the logic of the script will be inserted by the module.

### First Steps

* create a Region. It can be a Region that covers the entire room, and every token will trigger Behavior of the Region when step in. Or it can be a Region on a corner of your map, so that n otken will ever get there. And you can trigger all the checks asigned to this region against all your players when you want.
* Give the region a name. Name of the region will be used in Journal "Log: Important Events", when a Behavior of the Region is triggered. This way you always can find how exactly which Behavior was triggered by which player.
* Select Region and then run macros <img src="assets/icons/region-automation-main.png" width="30" alt="Main dialog"> (RegionAutomationMainMacros)
* You will see this menu <img src="docs/images/main_menu.png" alt="Main dialog"> 

### Investigate

If you have pressed "Investigation" on the Main Menu:

<img src="docs/images/investigate_menu.png" alt="Investigation menu">

This is an investigate check. You set up a default DC for this check, choose skills and try to define, how easy is it to find this out with that skill.

You may end up with something like this:

<img src="docs/images/investigate_menu_filled.png" alt="Filled investigation window">

Assuming that through Arcana or Crafting the complexity is normal, with Thievery you can figure it out by dealing with a technical part of it, and Society could help you to know that such elevators used to be popular in a high society, but probability of that is quite low, so the check is Very Hard.

Hint can contain @UUID... @Check[...] @Damage[...] and etc.

Then you press "Create".

#### When triggered

When a token of investigating character will enter the Region, GM will see a message like that:
<img src="docs/images/investigate_result.png" alt="Result of investigation">

In this case, the roll was very average, but unfortunately it wasn't enough to unerstand the purpose of the room. Taking into an account that Esoteric Lore and Undead Lore doubtly can help a character to get it.
GM may just omit this part.

### Search

If you have pressed "Search" on the Main Menu:

<img src="docs/images/search_menu_filled.png" alt="Filled search window">

This is slightly simpler. The only parameter we choose -- are we searching for an NPC, or an Item/Hazzard. Because there are feats that help in finding living beings, like "Sensate Gnome", or "Trap Finder" for traps.

Hint can contain @UUID... @Check[...] @Damage[...] and etc.

Then you press "Create".

#### When triggered

When a token of an searching character enters the Region, GM will see a message like that:

<img src="docs/images/search_result.png" alt="Search result message">

In this case a hero had noticed the sound, and GM may mention that.

GM may decide to reduce the DC of the investigation check, which may affect the result, the result of investigation check can be found in journal "Log: Important Events".

### Detect Magic

If you have pressed "Detect Magic" on the Main Menu:
<img src="docs/images/detect_magic_menu_filled.png" alt="Filled detect magic window">

Detect Magic works automatically, but doesn't provide any specific info. It is not easy to remember if a room has anything magical (like  runic weapon in a locked chest), but besides remiding about that, this check allows actually get some more specific clues if the check, defined by GM, is passed.
It is up to GM to use it, but heroes usually are happy to get some info from a magical search.

GM can choose any magical traditions and add them to different complexity, simultaneously or not.

Hint can contain @UUID... @Check[...] @Damage[...] and etc.

#### When triggered

When a token of a character, who has detect magic exploration activity, enters the Region, GM will see a message like that:

<img src="docs/images/detect_magic_result.png" alt="Search result message">

So, GM definitely should notify the player that a magic in presented in the area, and maybe even mention a rank of the most powerful magical effect, if the level of the cantrip is high enough.

But also he may give a hint to players, deducted by this magic detection.

### Saving Throw

If you have pressed "Saving Throw" on the Main Menu:
<img src="docs/images/saving_throw_edit_menu.png" alt="Filled detect magic window">

GM can use Reflex, Fortitude and Will.

GM Notes can contain @UUID... @Check[...] @Damage[...] and etc.

This thing will work on every character token entering the region.

#### When triggered

<img src="docs/images/saving_throw_result.png" alt="Search result message">

GM will get a message like that, and, in this example, can apply the damage by pressing the button. Or whatever else effect, which can be stored in GM Notes field.

## IMPORTANT: Created with a heavy use of AI

