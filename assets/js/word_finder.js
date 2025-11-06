---
---
function wordFinderGame(options = {}){
	(function () {
		// --------- Configuration & Persistence ----------
		const DEFAULTS = {
			containerID: null, // selector or Element
		};
		const opts = { ...DEFAULTS, ...options };
		let container = document.getElementById(opts.containerID) || document.querySelector(opts.containerID) || document.body;
		const style = document.createElement("style");
		style.textContent = `
.modal{width: 0px;
  width: 100%;
  top: 0;
  position: fixed;
  background: black;
  bottom: 0;
  left: 0;
  z-index: 99999999;
	}
.modal .modal-content {background: #333;
  padding: 15px; 
  width: 85vw;
  height: 85vh;;
  margin: 3vh auto;
  border-radius: 15px;overflow-y: auto;}
.modal button#btnCloseMessage {
background: #c33;
  width: 85vw;
  margin: auto;
  display: block;}
		
#toastyContainer {
	text-align: center;
	position: fixed;
	z-index: 1;
	right: 30px;
	bottom: 30px;
	color: #fff;
}
.toasty{
	font-size: 17px;
	border-radius: 5px;
	background-color: #333;
	width: 250px;
	max-width: 250px;
	word-wrap: break-word;
	margin-top: 3px;
	position:relative;
}
.toastyText{
	word-wrap: anywhere;
	padding: 16px;
	display: inline-block;
}
.toastyClose{
	top: 10px;
	position: absolute;
	right: 10px;
}


			#wordFinderGame #grid-guess>div {
				display: grid;
				/*grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
				gap: 3px;*/
				background-color: var(--main-color);
				padding-bottom: 2px;
				max-width:1000px;
				margin: auto;
			}

			#wordFinderGame #grid-guess>div>div{
				background-color: #555;
				text-align: center;
				border: 3px solid #000;
				font-size: 30px;
			}
			#wordFinderGame #grid-container>div {
				background-color: #555;
				text-align: center;
				padding: 10px 0;
				font-size: 30px;
			}
			#wordFinderGame #grid-container {
				max-width:1500px;
				margin: auto;
				display: grid;
				grid-template-columns: 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr;
				gap: 3px;
				background-color: var(--main-color);
				padding: 3px;
			}
			#wordFinderGame #grid-container .isMulti{
				background-color: #f80;
				text-decoration: underline;
				font-style: italic;
				font-weight: bolder;
			}		
			#wordFinderGame #grid-container .isSingle,#wordFinderGame #grid-guess .isCorrect{
				background-color: #0f0;
				font-style: italic;
				font-weight: bolder;
			}		
			#wordFinderGame #grid-container .isNot{
				background-color: #999;
				text-decoration: line-through;
			}
			#wordFinderGame #grid-guess .isInWord{
				background-color: #ff0;
				font-style: italic;
				font-weight: bolder;
				text-decoration: line-through;
			}
			#wordFinderGame button{
				padding: 8px;
				border: none;
				background: #3c3;
				border-radius: 10px;
				color: #ccc;
				font-weight: bolder;
				font-size: 1.2rem;
				width: 100%;
			}
			#wordFinderGame #inputFocus{
				opacity: 0;
				height: 1px;
				width: 1px;
				border: none;
				position: fixed;
				top:0;
				right:0;
			}
			#wordFinderGame .btnFlexRow{
				display: flex;
				gap: 5px;
				padding: 5px;
				flex-direction: row;
				flex-wrap: wrap;
			}
			#wordFinderGame .btnFlexRow button{
				flex:1;
			}
			#wordFinderGame #WordLengthButtons button.currentLen{
				background: #ccc;
				color: #3c3;
			}
			`;
		container.appendChild(style);
		const _div = document.createElement("div");
		_div.id = "wordFinderGame";
		_div.innerHTML = `
			<h1>Word Finder</h1>
			Word Length: <!--<input id="inpWordLength" type="number" min="4" max="12" value="5">-->
			<div id="WordLengthButtons" class="btnFlexRow">				
			</div>
			<div class="btnFlexRow">
				<button id='btnNewGame'>New Game</button>
				<button id='btnViewHistory'>History</button>
				<button id='btnViewStats'>Stats</button>
			</div>
			<hr/>
			<div id="dailyFlag" style="text-align: center;padding-bottom: 5px;"><b><i><u>Daily Word</u></i></b></div>
			<div id="gameArea">
				<input id="inputFocus" readonly>
				<div id="grid-guess" style="max-height: calc(100vh - 250px);overflow-y: auto;"></div>
				<hr/>
				<div id="wordFinderDefinition" style="text-align:center;"></div>
				<hr/>
				<div id="grid-container"></div>
			</div>
			<button id="btnDownloadGame">Download Finished Game</button>
			<style id="adjustWordsTable"></style>
			<canvas id="canvasWordFinderExport" style="border:1px solid;display:none;"></canvas>
			<div id="toastyContainer"></div>
			<div id="divMessageModal" class="modal" style="width: 100%;display:none;">
				<div class="modal-content">
					<header class="messageHeading"></header>
					<p class="messageText"></p>
				</div>
				<button id="btnCloseMessage">X</button>
			</div>
			`;
		container.appendChild(_div);
      	//document.getElementById("inpWordLength").addEventListener("click", () => changeWordLength(document.getElementById("inpWordLength").value));
      	document.getElementById("btnNewGame").addEventListener("click", () => initWordFinder());
      	document.getElementById("btnViewHistory").addEventListener("click", () => seeHistory());
      	document.getElementById("btnViewStats").addEventListener("click", () => seeGameStats());
      	document.getElementById("gameArea").addEventListener("click", () => focusInput());
      	document.getElementById("btnDownloadGame").addEventListener("click", () => candown('canvasWordFinderExport', 'png'));
      	document.getElementById("inputFocus").addEventListener("keyup", () => keyboardCapture(event));
      	document.getElementById("btnCloseMessage").addEventListener("click", () => message());
		var wordLengths = 5; //min 4 max 9
      	const WordLengthButtons = document.getElementById("WordLengthButtons");
		for (let i = 4; i < 13; i++) {
			const _btn = document.createElement("button");
			_btn.id = 'inpWordLength-' + i;
			_btn.innerText = i;
			if (i == wordLengths) _btn.classList.add("currentLen");
			_btn.addEventListener("click", () => changeWordLength(i));
			WordLengthButtons.appendChild(_btn);
		}

		// Local Storage Functions
		function getLocal(id) {
			id = id || ""
			if (id != "" && localStorage.getItem(id) != null) {
				return localStorage.getItem(id);
			} else {
				var x = getElem("localStorage" + id)
				if (x != null) {
					return x.dataset.localvalue;
				} else {
					return null;
				}
			}
		}
		function setLocal(id, value, forceHTMLStore = false) {
			id = id || "";
			if (id == "") {
				return 0;
			} else {
				value = value || null;
				try {
					forceHTMLStore ? null : localStorage.setItem(id, value);
				} catch (e) {
					forceHTMLStore = true;
				}
				if (forceHTMLStore) {
					delLocal(id);
					var x = document.createElement("div");
					x.id = "localStorage" + id;
					x.setAttribute("style", "display:none !important;");
					x.dataset.localvalue = value;
					document.getElementsByTagName("body")[0].appendChild(x);
				}
				return 1;
			}
		}
		function delLocal(id) {
			localStorage.removeItem(id);
			var x = getElem("localStorage" + id);
			x != null ? x.remove() : null;
		}
		//End Local Storage Functions

		function getElem(id) {
			return document.getElementById(id) || null;
		}
		function msToTime(duration) {
			var x = "-";
			var milliseconds = Math.floor((duration % 1000) / 100),
				seconds = Math.floor((duration / 1000) % 60),
				minutes = Math.floor((duration / (1000 * 60)) % 60),
				hours = Math.floor((duration / (1000 * 60 * 60)) % 24),
				days = Math.floor((duration / (1000 * 60 * 60 * 24)));
			hours = (hours < 10) ? "0" + hours : hours;
			minutes = (minutes < 10) ? "0" + minutes : minutes;
			seconds = (seconds < 10) ? "0" + seconds : seconds;
			x = seconds > 0 ? (seconds + "s") : x;
			x = minutes > 0 ? (minutes + "m" + seconds + "s") : x;
			x = hours > 0 ? (hours + "h" + minutes + "m" + seconds + "s") : x;
			x = days > 0 ? (days + "d" + hours + "h" + minutes + "m" + seconds + "s") : x;
			return x;
		}
		function message(txt = "", heading = "Alert") {
			var messageElem = getElem('divMessageModal');
			messageElem.style.display = 'none';
			getClass("messageHeading", messageElem)[0].innerHTML = heading;
			getClass("messageText", messageElem)[0].innerHTML = txt;
			if (txt != "") {
				messageElem.style.display = 'block';
			}
		}
		const wordFile = window.location.protocol + "//" + window.location.host + '{{ "/assets/words.txt" | relative_url }}';
		var isDaily = false;
		var resettable = true;
		var sucess = false;
		var chosenWord = "";
		var currentGuess = 0;
		var currentLetter = 0;
		var guessedLetters = [];
		const returnSymbol = "⏎";
		const backSymbol = "⌫";
		const keyBoard = [
			{ "L": "q", "O": 1 }, { "L": "w", "O": 2 }, { "L": "e", "O": 3 }, { "L": "r", "O": 4 }, { "L": "t", "O": 5 }, { "L": "y", "O": 6 },
			{ "L": "u", "O": 7 }, { "L": "i", "O": 8 }, { "L": "o", "O": 9 }, { "L": "p", "O": 10 },

			{ "L": "a", "O": 11 }, { "L": "s", "O": 12 }, { "L": "d", "O": 13 }, { "L": "f", "O": 14 }, { "L": "g", "O": 15 }, { "L": "h", "O": 16 },
			{ "L": "j", "O": 17 }, { "L": "k", "O": 18 }, { "L": "l", "O": 19 }, { "L": returnSymbol, "O": 19.5, "A": "span 2" },

			{ "L": "z", "O": 20 }, { "L": "x", "O": 21 }, { "L": "c", "O": 22 }, { "L": "v", "O": 23 }, { "L": "b", "O": 24 },
			{ "L": "n", "O": 25 }, { "L": "m", "O": 26 }, { "L": backSymbol, "O": 26.5, "A": "auto / span 2" }
		];

		var gameState = { "state": 0 };
		function focusInput() {
			getElem('inputFocus').focus();
		}

		async function changeWordLength(val) {
			val = (val * 1) || 5;
			val = val < 4 ? 4 : val;
			val = val > 12 ? 12 : val
			for (let i = 4; i < 13; i++) {
				const _btn = document.getElementById('inpWordLength-' + i);
				_btn.classList.remove("currentLen");
				if (i == val) _btn.classList.add("currentLen");
			}
			//getElem("inpWordLength").value = val;
			wordLengths = val;
			resettable = true;
			await initWordFinder(true);
		}

		async function initWordFinder(fromSeed) {
			fromSeed = fromSeed || false;
			if (resettable) {
				displayNoneByID("btnDownloadGame");
				getElem("wordFinderDefinition").innerHTML = "";
				chosenWord = "";
				gameState = { "state": 0 };
				gameState = getLocal("wordFinderGameState") ? JSON.parse(getLocal("wordFinderGameState"))[wordLengths] : gameState;
				gameState = (gameState == null || gameState == undefined) ? { "state": 0 } : gameState;
				if ("ChosenWord" in gameState) {
					chosenWord = window.atob(gameState.ChosenWord);
					wordLengths = chosenWord.split("").length;
					//getElem("inpWordLength").value = wordLengths;
					isDaily = gameState.IsDaily;
				}
				resettable = false;
				focusInput();
				sucess = false;
				guessedLetters = [];
				currentGuess = 0;
				currentLetter = 0;
				if (chosenWord == "") {
					var x = await getWords(wordLengths);
					var dailyComplete = false;
					var history = getLocal("wordFinderHistory") ? JSON.parse(getLocal("wordFinderHistory")) : {};
					var dailyLevel = 0;
					for (var key in history) {
						if (key == UTCString()) {
							dailyLevel = history[key].filter(function (item) { return item.W.length == wordLengths }).length;
							dailyComplete = history[key].filter(function (item) { return item.W.length == wordLengths && item.D; }).length > 0;
						}
					}
					chosenWord = x[Math.floor(randSeed(UTCString() + wordLengths, dailyLevel) * (x.length + 1))];
					if (fromSeed && !dailyComplete) {
						isDaily = true;
					} else {
						isDaily = false;
						//chosenWord = x[Math.floor(Math.random() * x.length)];
					}
					dailyLevel > 0 ? toastyMake("Daily Word Complete - Current Level: " + dailyLevel) : null;
					gameState.StartTime = UTCString(true);
					gameState.IsDaily = isDaily;
				}
				if (isDaily) {
					displayBlockByID("dailyFlag");
				} else {
					displayNoneByID("dailyFlag");
				}
				var y = getElem('grid-guess');
				var d = "";
				var frames = "";
				for (var a = 0; a < (wordLengths + 1); a++) {
					d += "<div id='guess-word-" + a + "'>";
					for (var b = 0; b < wordLengths; b++) {
						d += "<div class='letter-" + b + "'>&nbsp;</div>";
						if (a == 0) {
							frames += " 1fr";
						}
					}
					d += "</div>";
				}
				y.innerHTML = d;
				getElem('adjustWordsTable').innerHTML = "#grid-guess>div {grid-template-columns:" + frames + ";}"
				makeKeyBoard();
				if (("Words" in gameState) && gameState.Words.length > 0) {
					for (var i = 0; i < gameState.Words.length; i++) {
						var inputWordLetters = gameState.Words[i].split("");
						for (var j = 0; j < inputWordLetters.length; j++) {
							await enterKey(inputWordLetters[j]);
						}
						await enterKey(returnSymbol);
					}
				}
			} else {
				toastyMake("Finish Game First");
			}
		}

		function makeKeyBoard() {
			var wordChars = chosenWord.toUpperCase().split("");
			var z = getElem('grid-container');
			z.innerHTML = "";
			for (var c = 0; c < keyBoard.length; c++) {
				const thisLetter = keyBoard[c].L.toUpperCase();
				const _keyboardkey = document.createElement("div");
				if(guessedLetters.indexOf(thisLetter) > -1){
					if(wordChars.indexOf(thisLetter) === -1) _keyboardkey.classList.add("isNot");
					_keyboardkey.classList.add((chosenWord.toUpperCase().match(new RegExp(thisLetter, "g")) || []).length > 1 ? "isMulti" : "isSingle");
				}
				if(keyBoard[c].A) _keyboardkey.style = "grid-area:" + keyBoard[c].A;
				_keyboardkey.innerText = thisLetter;
      			_keyboardkey.addEventListener("click", () => enterKey(thisLetter));
				z.appendChild(_keyboardkey);
			}
		}

		async function keyboardCapture(e) {
			var key = e.keyCode || e.which;
			switch (key) {
				case 13:
					await enterKey(returnSymbol);
					break;
				case 8:
					await enterKey(backSymbol);
					break;
				default:
					await enterKey(String.fromCharCode(key).toUpperCase());
					break;
			}
			getElem('inputFocus').value = "";
		}

		async function enterKey(letter) {
			if (sucess == true) {
				toastyMake("sucess, please start new game");
				return;
			}
			if (currentGuess == (wordLengths + 1)) {
				toastyMake("Failed, please start new game. Word: " + chosenWord);
				return;
			}
			var timeTaken = 0;
			var ok = false;
			var letters = keyBoard.filter(function (item) { return item.L.toUpperCase() == letter; });
			if (letters.length > 0) {
				var finishedGame = false;
				var elem = getElem('guess-word-' + currentGuess);
				ok = true;
				switch (letter) {
					case returnSymbol:
						if (currentLetter == wordLengths) {
							var word = "";
							for (var b = 0; b < wordLengths; b++) {
								word += getClass("letter-" + b, elem)[0].innerHTML;
							}
							if (!("Words" in gameState)) { gameState.Words = []; }
							gameState.ChosenWord = window.btoa(chosenWord);
							var wordExists = await isWord(word)
							if (wordExists) {
								gameState.Words[currentGuess] = word;
								guessedLetters = guessedLetters.concat(word.split(""));
								makeKeyBoard();
								if (word == chosenWord.toUpperCase()) {
									for (var y = 0; y < wordLengths; y++) {
										addClasses(getClass("letter-" + y, elem)[0], ["isCorrect"]);
									}
									finishedGame = true;
									sucess = true;
									timeTaken = new Date(UTCString(true)).getTime() - new Date(gameState.StartTime).getTime();
									toastyMake("Correct :)");
								} else {
									var wordChars = chosenWord.toUpperCase().split("");
									for (var z = 0; z < wordLengths; z++) {
										var letterElem = getClass("letter-" + z, elem)[0];
										var lettercheck = letterElem.innerHTML;
										addClasses(letterElem, (wordChars[z] == lettercheck ? ["isCorrect"] : (wordChars.indexOf(lettercheck) > -1 ? ["isInWord"] : [])));
									}
									if (currentGuess == wordLengths) {
										finishedGame = true;
										toastyMake("Failed! Word: " + chosenWord);
									} else {
										toastyMake("Try Again");
									}
									currentGuess++;
									currentLetter = 0;
								}
							} else {
								toastyMake("Word Not Found!");
							}
						} else { toastyMake("Please Fill All Letters"); }
						break;
					case backSymbol:
						currentLetter--;
						currentLetter = currentLetter < 0 ? 0 : currentLetter;
						getClass("letter-" + currentLetter, elem)[0].innerHTML = "&nbsp;";
						break;
					default:
						if (currentLetter < wordLengths) {
							getClass("letter-" + currentLetter, elem)[0].innerHTML = letter;
							currentLetter++;
							currentLetter = currentLetter > wordLengths ? wordLengths : currentLetter;
						}
						break;
				}
				if (finishedGame) {
					gameStatsSet(wordLengths, sucess, timeTaken);
					var todayTimeZero = gameState.StartTime.split("T")[0] + "T00:00:00Z";
					var history = getLocal("wordFinderHistory") ? JSON.parse(getLocal("wordFinderHistory")) : {};
					if (!(todayTimeZero in history)) { history[todayTimeZero] = []; }
					history[todayTimeZero].push({ "W": chosenWord, "T": timeTaken, "S": sucess, "D": isDaily });
					for (var key in history) {
						if ((new Date(UTCString()).getTime() - new Date(key).getTime()) > (1000 * 60 * 60 * 24 * 7)) {
							delete history[key];
						}
					}
					setLocal("wordFinderHistory", JSON.stringify(history));
					createCanvasImage();
					gameState = { "state": 0 };
					displayBlockByID("btnDownloadGame");
					resettable = true;
					findDefinition();
				}
			}
			var storeGameState = getLocal("wordFinderGameState") ? JSON.parse(getLocal("wordFinderGameState")) : [];
			storeGameState[wordLengths] = gameState;
			setLocal("wordFinderGameState", JSON.stringify(storeGameState));
		}
		function gameStatsSet(roundID, win, msDateTime) {
			roundID = roundID || 0;
			msDateTime = msDateTime || -1;
			win = win || false;
			var x = {};
			x = gameStatsGet();
			if (!(roundID in x.round) || x.round[roundID] == null) { x.round[roundID] = { "wins": 0, "winStreak": 0, "fastestWin": 0, "losses": 0 }; }
			if (win) {
				x.round[roundID].wins++;
				x.round[roundID].winStreak++;
				x.totRound.winStreak++;
				if (msDateTime > 0) {
					x.round[roundID].fastestWin = (msDateTime < x.round[roundID].fastestWin || x.round[roundID].fastestWin == 0) ? msDateTime : x.round[roundID].fastestWin;
				}
			} else {
				x.round[roundID].losses++;
				x.round[roundID].winStreak = 0;
				x.totRound.winStreak = 0;
			}
			setLocal("wordFinderStats", JSON.stringify(x));
		}

		function gameStatsGet() {
			return getLocal("wordFinderStats") ? JSON.parse(getLocal("wordFinderStats")) : { "round": [], "totRound": { "winStreak": 0 } };
		}
		function seeGameStats() {
			var x = gameStatsGet();
			var totWins = 0;
			var totLosses = 0;
			var zz = "";
			for (var key in x.round) {
				if (x.round[key] != null) {
					totWins += x.round[key].wins;
					totLosses += x.round[key].losses;
					zz += "<b>Word Length " + key + "</b><br />Wins: " + x.round[key].wins + " | Losses: " + x.round[key].losses + "<br />Win Streak: " + x.round[key].winStreak + "<br />Fastest Win: " + msToTime(x.round[key].fastestWin) + "<br />";
				}
			}
			zz += "<b>Total</b><br />Wins: " + totWins + " | Losses: " + totLosses + "<br />Win Streak: " + x.totRound.winStreak + "<br />";
			message(zz == "" ? "-" : zz, "Stats");
		}
		function seeHistory() {
			var history = getLocal("wordFinderHistory") ? JSON.parse(getLocal("wordFinderHistory")) : {};
			var zz = "";
			for (var key in history) {
				zz += key.split("T")[0] + ' - Wins: ' + history[key].filter(function (item) { return item.S == 1; }).length + "/" + history[key].length;
				for (var i = 0; i < history[key].length; i++) {
					zz += "<br /><span style='color:" + (history[key][i].S ? "#0f0'" : "#f00") + "'>" + history[key][i].W.toUpperCase() + " - " + msToTime(history[key][i].T) + (history[key][i].D ? " - Daily" : "") + "</span>";
				}
				zz += "<br />";
			}
			message(zz == "" ? "-" : zz, "History");
		}
		function findDefinition() {
			getElem("wordFinderDefinition").innerHTML = "Find out more about the word <u><a href='https://en.wiktionary.org/wiki/" + chosenWord.toLowerCase() + "' target='definitionsJovialBadger'>" + chosenWord + "</a></u>";
		}
		docReady(async function () {
			await initWordFinder(true);
		});
		function docReady(fn) {
			if (document.readyState !== 'loading') {
				fn();
				return;
			}
			document.addEventListener('DOMContentLoaded', fn);
		}
		function displayBlockByID(id) {
			var x = getElem(id);
			x != null ? x.style.display = 'block' : null;
		}

		function displayNoneByID(id) {
			var x = getElem(id);
			x != null ? x.style.display = 'none' : null;
		}
		async function fetchData(URL, dataType, storeDataName = "", expirySecs = (60 * 60 * 24 * 7)) {
			var data = null;
			var useCache = true;
			if (storeDataName != "") {
				data = getLocal(storeDataName);
				if (data != null) {
					if (new Date(UTCString(true)).getTime() - new Date(data).getTime() > 1000 * expirySecs) {
						delLocal(storeDataName);
						useCache = false;
					}
				} else {
					delLocal(storeDataName);
					useCache = false;
				}
			}
			var cache = await caches.open("my-cache");
			var dl = useCache ? await cache.match(URL) : await fetch(URL);
			dl = (!dl?.ok ?? true) ? await fetch(URL) : dl;
			if (!dl.ok) { return null; }
			cache.put(URL, dl.clone());
			var processedData = null;
			switch (dataType) {
				case "CSV":
					processedData = CSVToObj(await dl.text());
					break;
				case "OBJECT":
					processedData = CSVToObj(await dl.text(), ",", "object");
					break;
				case "TXT":
				default:
					processedData = await dl.text();
			}
			if (storeDataName != "" && !useCache) {
				setLocal(storeDataName, UTCString(true));
			}
			return processedData;
		}


		function cyrb128(str) {
			let h1 = 1779033703, h2 = 3144134277,
				h3 = 1013904242, h4 = 2773480762;
			for (let i = 0, k; i < str.length; i++) {
				k = str.charCodeAt(i);
				h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
				h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
				h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
				h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
			}
			h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
			h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
			h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
			h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
			return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
		}

		function randSeed(seed, iteration = 0) {
			if (iteration > 50000) { return null; }
			// Create cyrb128 state:
			var seed = cyrb128(seed);
			// Four 32-bit component hashes provide the seed for sfc32.
			var rand = sfc32(seed[0], seed[1], seed[2], seed[3]);
			for (var j = 0; j < iteration; j++) { rand(); }
			return rand();
		}

		function addClasses(elem, classes) {
			for (i = 0; i < classes.length; i++) {
				elem.classList.add(classes[i]);
			}
		}
		function itemFromObjDateSeed(obj) {
			if (obj.length > 0) {
				var objNumber = Math.floor(randSeed(UTCString()) * (obj.length + 1));
				return obj[objNumber];
			}
		}
		function toastyMake(txt, close, timeClose, bgColour, txtColour) {
			close = close || false;
			bgColour = bgColour || "";
			txtColour = txtColour || "";
			timeClose = timeClose || 0;
			txt = txt || "";
			if (txt != "") {
				var x = document.getElementById("toastyContainer");
				var toast = document.createElement("div");
				toast.innerHTML = "<span class='toastyText' style='" + (txtColour != "" ? "color:" + txtColour + ";" : "") + (close ? "padding-right:50px;" : "") + "'>" + txt + "</span>" + (close ? "<span class='toastyClose' onclick='this.parentNode.remove()'>&#10005;</span>" : "");
				toast.className = "toasty";
				bgColour != "" ? toast.style.background = bgColour : "";
				close ? null : toast.setAttribute("onclick", "this.remove()");
				x.appendChild(toast);
				setTimeout(function () { toast.remove(); }, (timeClose == 0 ? (close ? 10000 : 3000) : timeClose));
			}
		}
		function getClass(id, parent) {
			parent = parent || document;
			return parent.getElementsByClassName(id) || null;
		}

		function sfc32(a, b, c, d) {
			return function () {
				a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
				var t = (a + b) | 0;
				a = b ^ b >>> 9;
				b = c + (c << 3) | 0;
				c = (c << 21 | c >>> 11);
				d = d + 1 | 0;
				t = t + d | 0;
				c = c + t | 0;
				return (t >>> 0) / 4294967296;
			}
		}
		function UTCString(incTime) {
			incTime = incTime || false;
			const d = new Date();
			return (d.getUTCFullYear() + "-" + addLeadingZeros(d.getUTCMonth() + 1, 2) + "-" + addLeadingZeros(d.getUTCDate(), 2)) + "T" + (incTime ? (addLeadingZeros(d.getUTCHours(), 2) + ":" + addLeadingZeros(d.getUTCMinutes(), 2) + ":" + addLeadingZeros(d.getUTCSeconds(), 2)) : "00:00:00") + "Z";
		}
		function addLeadingZeros(num, totalLength) {
			if (num < 0) {
				const withoutMinus = String(num).slice(1);
				return '-' + withoutMinus.padStart(totalLength, '0');
			}
			return String(num).padStart(totalLength, '0');
		}
		async function getWords(len, uCase) {
			uCase = uCase || "1";
			len = len || -1;
			var data = await fetchData(wordFile, "TXT", "Words");
			if (data != null) {
				if (data.indexOf('\n\r') > -1) { data = data.split("\n\r"); }
				if (data.indexOf('\r\n') > -1) { data = data.split("\r\n"); }
				if (data.indexOf('\n') > -1) { data = data.split("\n"); }
				if (data.indexOf('\r') > -1) { data = data.split("\r"); }
				var a = [];
				for (var i = 0; i < data.length; i++) {
					if (!data[i].startsWith("//")) {
						if (!(data[i].length in a)) { a[data[i].length] = []; }
						a[data[i].length].push(uCase == 1 ? data[i].toUpperCase() : data[i].toLowerCase())
					}
				}
				return len == -1 ? a : a[len];

			} else {
				return null;
			}
		}

		async function isWord(word) {
			var x = await getWords(word.length);
			return x.filter(function (item) { return item == word.toUpperCase(); }).length > 0;
		}
		function candown(target, type) {
			if (sucess !== true) {
				toastyMake("Finish Game First");
				return;
			}
			let canvas = getElem(target);
			let anchor = document.createElement("a");
			anchor.download = "download." + type;
			anchor.href = canvas.toDataURL("image/" + type);
			// (B3) "FORCE DOWNLOAD"
			anchor.click();
			anchor.remove();
			// (B4) SAFER ALTERNATIVE - LET USER CLICK ON LINK
			//anchor.innerHTML = "Download";
			//document.body.appendChild(anchor);
		}
		function createCanvasImage() {
			var canvas = getElem("canvasWordFinderExport");
			var ctx = canvas.getContext('2d');
			var wordlength = gameState.Words[0].split("").length;
			var words = gameState.Words.length;
			var size = 100;
			var rectWidth = size;
			var rectHeight = size;
			canvas.setAttribute("width", (wordlength) * rectWidth + "px");
			canvas.setAttribute("height", (words + 5) * rectHeight + "px");
			ctx.font = (size / 2) + "px Impact";
			ctx.textAlign = "center";
			var totHeight = 0;
			var wordletters = chosenWord.toUpperCase().split("");
			ctx.fillStyle = "rgba(200,200,200,1)";
			ctx.fillRect(0, 0, (wordlength) * rectWidth, (words + 5) * rectHeight);
			for (j = 0; j < words; j++) {
				var text = gameState.Words[j];
				for (i = 0; i < wordlength; i++) {
					ctx.fillStyle = text[i] == wordletters[i] ? "rgba(0,150,0,1)" : wordletters.indexOf(text[i]) > -1 ? "rgba(255,255,0,1)" : "rgba(255,0,0,1)";
					ctx.beginPath();
					ctx.rect(i * rectWidth, j * rectHeight, rectWidth, rectHeight);
					ctx.fillText(text[i], i * rectWidth + (rectWidth / 2), ((rectHeight / 2) + rectHeight * j) + rectHeight / 4);
					ctx.stroke();
				}
				totHeight++;
			}
			ctx.font = (size / 4) + "px Impact";
			ctx.fillStyle = "rgba(0,0,0,1)";
			ctx.beginPath();
			ctx.fillText(chosenWord.toUpperCase(), ((wordlength * rectWidth) / 2), ((rectHeight / 2) + rectHeight * (totHeight)) + rectHeight / 4);
			ctx.stroke();
			ctx.font = (size / 2) + "px Impact";
			totHeight++;
			var letter = 0;
			for (j = 0; j < 3; j++) {
				for (i = 0; i < 10; i++) {
					if (keyBoard.length - 1 > (letter)) {
						var thisLetter = keyBoard[letter].L.toUpperCase();
						thisLetter = thisLetter.replace(returnSymbol, " ").replace(backSymbol, " ");
						var multi = (chosenWord.toUpperCase().match(new RegExp(thisLetter, "g")) || []).length > 1;
						ctx.fillStyle = guessedLetters.indexOf(thisLetter) > -1 ? (wordletters.indexOf(thisLetter) > -1 ? (multi ? "rgba(255,127.5,0,1)" : "rgba(0,150,0,1)") : "rgba(255,0,0,1)") : "rgba(0,0,0,1)";
					} else {
						ctx.fillStyle = "rbga(0,0,0,1)"
					}
					ctx.beginPath();
					var wid = (wordlength * rectWidth) / 10;
					ctx.rect(i * wid, (j + totHeight) * rectHeight, wid, rectHeight);
					ctx.fillText(keyBoard.length - 1 < (letter) ? "" : keyBoard[letter].L.toUpperCase().replace(returnSymbol, " ").replace(backSymbol, " "), (i) * wid + (wid / 2), ((rectHeight / 2) + rectHeight * (j + totHeight)) + rectHeight / 4);
					ctx.stroke();
					letter++;
				}
			}
			totHeight++;
			totHeight++;
			totHeight++;
			ctx.font = (size / 6) + "px Impact";
			ctx.fillStyle = "rgba(0,0,0,1)";
			ctx.beginPath();
			ctx.fillText(window.location.protocol + "//" + window.location.hostname + window.location.pathname, ((wordlength * rectWidth) / 2), ((rectHeight / 2) + rectHeight * (totHeight)) + rectHeight / 4);
			ctx.stroke();
		}
	})();
}