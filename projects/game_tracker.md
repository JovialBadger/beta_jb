---
layout: default
title: Game Tracker
category: Games
order: 1
---
<div id='containerGameTracker'></div>
<script src="{{ "/assets/js/game_tracker.js" | relative_url }}"></script>
<script>
  /*
    createScoreboard(container, options)
    - container: DOM element or selector string
    - options: {
        game: { Location, League, Date, Time, MatchNo, Periods, PeriodsConfig, ShotClock, Arrow },
        teams: {
          Home: { Name, Colour, TimeOuts, Players: [{ Name, LicenceNo, KitNumber }] },
          Away: { ... }
        },
        rules: { maxFoulsPerPlayer, maxTeamFoulsPerPeriod }
      }
  */
  const board = createScoreboard('#containerGameTracker', { game: { League: "Local Cup", MatchNo: "A1" }, teams: { Home: { Name: "Lions" }, Away: { Name: "Tigers" } } });
</script>