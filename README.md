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

## How To Use

### Wording
- Region -- a Foundry entity GM can create using "Region Controls" menu
- Region Behavior -- a trigger added to the tab "Behaviors" of a "Region". It has a name and a type. In case of this module, the type will always be "Execute Script", and will be subscribed to specific events automatically, and the logic of the script will be inserted by the module.

### First Steps

* create a Region. It can be a Region that covers the entire room, and every token will trigger Behavior of the Region when step in. Or it can be a Region on a corner of your map, so that n otken will ever get there. And you can trigger all the checks asigned to this region against all your players when you want.
* Give the region a name. Name of the region will be used in Journal "Log: Important Events", when a Behavior of the Region is triggered. This way you always can find how exactly which Behavior was triggered by which player.
* Select Region and then run macros <img src="assets/icons/region-automation-main.png" width="30" alt="Main dialog"> (RegionAutomationMainMacros)
* You will see this menu <img src="docs/images/main_menu.png" alt="Main dialog"> 

### Investigate

<img src="docs/images/investigate_menu.png" alt="Investigation menu">

This is an investigate check. You set up a default DC for this check, choose skills and try to define, how easy is it to find this out with that skill.

You may end up with something like this:

<img src="docs/images/investigate_menu_filled.png" alt="Filled investigation window">

Assuming that through Arcana or Crafting the complexity is normal, with Thievery you can figure it out by dealing with a technical part of it, and Society could help you to know that such elevators used to be popular in a high society, but probability of that is quite low, so the check is Very Hard.

Then you press "Create".

#### When triggered

When a token of investigating character will enter the Region, GM will see a message like that:
<img src="docs/images/investigate_result.png" alt="Result of investigation">

In this case, the roll was very average, but unfortunately it wasn't enough to unerstand the purpose of the room. Taking into an account that Esoteric Lore and Undead Lore doubtly can help a character to get it.
GM may just omit this part.

## IMPORTANT: Created with a heavy use of AI

