const exec = require('child_process').exec;
const fs = require('fs');
const say = require('say');
const requestify = require('requestify');
const supplementals = require('./supplementals');
let prefs = {};

let psVars = {
	powerShellSessions: [],
	commandq: [],
	self: { out: [], err: [] },
	checkingIfDone: false,
	triggered: false,
	outputBin: '',
	errorBin: ''
};

let apps = [], groups = [];

function endsWith(search, suffix) {
	return search.indexOf(suffix, search.length - suffix.length) !== -1;
};

function replaceAll(str, find, replace) {
	return String.raw`${str}`.replace(new RegExp(find.replace(/([.*+?^=!:${}()|\[\]\/\\\r\n\t|\n|\r\t])/g, '\\$1'), 'g'), replace);
}

function isUrl(url) {
	return /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/.test(url);
}

function countStringOccurences(string, query) {
	return (string.match(new RegExp(query, 'g')) || []).length;
}

function regexIndexOf(str, regex, startpos) {
	var indexOf = str.substring(startpos || 0).search(regex);
	return (indexOf >= 0) ? (indexOf + (startpos || 0)) : indexOf;
}

String.prototype.replaceAll = function(t, e, n) {
	let r = "" + this, g = "", l = r, s = 0, h = -1
	for (n && (t = t.toLowerCase(), l = r.toLowerCase()); (h = l.indexOf(t)) > -1;)g += r.substring(s, s + h) + e, l = l.substring(h + t.length, l.length), s += h + t.length;
	return l.length > 0 && (g += r.substring(r.length - l.length, r.length)), g;
};

function once(fn, context) {
	let result;
	return function() {
		if (fn) {
			result = fn.apply(context || this, arguments);
			fn = null;
		}
		return result;
	};
}

function debounce(func, wait, immediate) {
	var timeout;
	return function() {
		var context = this, args = arguments;
		var later = function() {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};
		var callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		if (callNow) func.apply(context, args);
	};
};

let rebounceQ = [], rebouncing = false, lastRebounceWait;
function nextRebounce() {
	if (rebouncing == false) {
		if (rebounceQ.length > 0) {
			lastRebounceWait = rebounceQ[0].wait;
			rebouncing = true;
			setTimeout(() => {
				rebounceQ[0].callback();
				rebounceQ.shift();
				rebouncing = false;
				nextRebounce();
			}, rebounceQ[0].wait);
		} else {
			setTimeout(() => {
				nextRebounce();
			}, lastRebounceWait);
		}
	}
}
function rebounce(callback, wait) {
	rebounceQ.push({ callback, wait });
	nextRebounce();
};

function postbounce(func, wait, cb) {
	let timeout;
	return function() {
		let context = this, args = arguments;
		let later = function() {
			cb();
			timeout = null;
		}
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		func.apply(context, args);
	}
}

var TimerQueue = (function() {
	var timers = [];
	var running = false;
	var currentInterval;
	var currentTimer;

	this.addTimer = function(fn, delay) {
		timers.push({ fn: fn, delay: delay });

		function exec() {
			currentTimer.fn();
			clearInterval(currentInterval);
			if (timers.length > 0) {
				currentTimer = timers.shift();
				currentInterval = setInterval(exec, currentTimer.delay);
			} else {
				running = false;
			}
		}

		if (!running) {
			running = true;
			currentTimer = timers.shift();
			currentInterval = setInterval(exec, currentTimer.delay);
		}
	};

	this.clear = function() {
		if (currentInterval) {
			clearInterval(currentInterval);
		}
		timers = [];
		running = false;
	};

	return this;
});

async function tryForUntil(tries, delay, conditions, toTry, notMetCallback, successCallback) {
	for (let i = 0; i < tries; i++) {
		await (() => {
			return new Promise((resolve) => {
				setTimeout(() => {
					toTry();
					if (eval(conditions)) {
						i = tries; // Make the loop stop
						notMetCallback = null; // This should not run now
						if (typeof successCallback == 'function') successCallback();
					} else if (i == tries - 1) {
						if (typeof notMetCallback == 'function') notMetCallback();
					}
					else {
						resolve(); // Let the loop keep going
					}
				}, delay);
			});
		})();
	}
}

function isVerbose(option) {
	if (Win.prefs.log && Win.prefs.log.verbose && Win.prefs.log.verbose[option] === true) {
		return true;
	} else {
		return false;
	}
}

const parseAuthCode = function(receivedCode) {
	if (receivedCode == Win.prefs.masterKey) return true;
	if (typeof Win.prefs.authCodeParse !== 'function' && typeof Win.prefs.authCodeParse == undefined) {
		Win.error('Type of "authCodeParse" is not a function');
	}
	if (typeof Win.prefs.authCodeParse == 'function') {
		return Win.prefs.authCodeParse(receivedCode);
	} else {
		const s = parseInt(new Date().getSeconds().toString().charAt(0));
		let alph = 'abcdefghij'.split('');
		if (alph.indexOf(receivedCode.toLowerCase().charAt(0)) === s) return true; else return false;
	}
}

const authCode = {
	isValid: function(code) {
		if (code === undefined) {
			Win.error('No code provided');
			return false;
		} else if (code && parseAuthCode(code)) {
			if (code === Win.prefs.masterKey) Win.log('Master key authorized');
			else Win.log('Code "' + code + '" authorized');
			return true;
		} else if (!parseAuthCode(code)) {
			Win.log('Invalid code: "' + code + '".');
			return false;
		}
	}
};

function nircmd(command, callback, options) {
	Win.PowerShell('.\\nircmd ' + command, callback, options ? options : { noLog: true });
}

function speak() {
	let speechQ = [];
	let fn = function(phrase, TTSVoice, speed, callback) {
		if (!TTSVoice) TTSVoice = Win.prefs.TTSVoice;
		speaking = {
			now: null
		};
		function trySpeech() {
			speechQ.push(phrase);
			if (speaking.now === false || speechQ.length == 1) {
				speaking.now = true;
				say.speak(speechQ.slice(-1)[0], TTSVoice, speed, (err) => {
					speaking.now = false;
					speechQ.pop();
					if (callback) callback(err);
				});
			} else {
				setTimeout(() => {
					trySpeech();
				}, 250);
			}
		}
		trySpeech();
	};
	fn.now = function(phrase, TTSVoice) {
		if (!TTSVoice) TTSVoice = Win.prefs.TTSVoice;
		say.speak(phrase, TTSVoice);
	};
	fn.stop = callback => {
		say.stop(() => {
			if (callback) callback();
		});
	};
	fn.log = function(phrase, voice, speed) {
		Win.log('(Spoken): ' + phrase);
		Win.speak(phrase, voice, speed);
	};
	return fn;
}

function log() {
	function now(param, options) {
		let dateString = '';
		if (Win.prefs.log && Win.prefs.log.showTime) {
			dateString = new Date().toLocaleTimeString().toString() + ': ';
		}
		if (options && options.showTime == false) {
			dateString = '';
		}
		if (Win.prefs.log && Win.prefs.log.outputFile) fs.createWriteStream(Win.prefs.log.outputFile, { flags: 'a' }).write(dateString + param + '\n');
		console.log(dateString + param);
	}
	let fn = function(message, options) {
		let messages = Array.from(arguments).filter(el => {
			return (typeof el == 'string' || (typeof el == 'object' && !(el.colour !== undefined || el.background !== undefined)))
		});

		message = messages.join('');

		options = Array.from(arguments).filter(el => {
			return (typeof el == 'object' && (el.colour !== undefined || el.background !== undefined))
		});

		options = options[0];

		for (let i in arguments) {

		}
		let colour = '';
		if (options && (options.colour || options.color)) {
			colour = options.colour.toLowerCase() || options.color.toLowerCase();
			switch (colour) {
				case 'red':
					colour = '\x1b[31m';
					break;
				case 'green':
					colour = '\x1b[32m';
					break;
				case 'yellow':
					colour = '\x1b[33m';
					break;
				case 'blue':
					colour = '\x1b[34m';
				case 'magenta':
					colour = '\x1b[35m';
					break;
				case 'cyan':
					colour = '\x1b[36m';
					break;
				case 'white':
					colour = '\x1b[37m';
					break;
				case 'black':
					colour = '\x1b[30m';
					break;
				default:
					Win.error('Log: Could not find the colour ' + colour + '. See documentation for a complete list of colours');
			}
		}
		if (options && (options.background || options.backgroundColor)) {
			let background = options.background.toLowerCase() || options.backgroundColor.toLowerCase();
			switch (background) {
				case 'red':
					background = '\x1b[41m';
					break;
				case 'green':
					background = '\x1b[42m';
					break;
				case 'yellow':
					background = '\x1b[43m';
					break;
				case 'blue':
					background = '\x1b[44m';
				case 'magenta':
					background = '\x1b[45m';
					break;
				case 'cyan':
					background = '\x1b[46m';
					break;
				case 'white':
					background = '\x1b[47m';
					break;
				case 'black':
					background = '\x1b[40m';
					break;
				default:
					Win.error('Log: Could not find the background colour ' + background + '. See documentation for a complete list of background colours');
			}
			colour = colour + background;
		}
		if (!options) {
			now(message, options);
		} else {
			colour = colour + message + '\x1b[0m';
			now(colour, options);
		}
	};
	fn.speak = function(phrase, voice, speed, options) {
		Win.speak(phrase, voice, speed);
		Win.log('(Spoken): ' + phrase, options);
	};
	return fn;
}

//--The-big-one-------------------
const Win = {
	prefs: prefs,
	authCode: authCode,
	path: function(pathUrl) {
		pathUrl = replaceAll(pathUrl.raw[0], '\\', '\\\\');
		if (endsWith(pathUrl, '\\\\')) pathUrl = pathUrl.substring(0, pathUrl.lastIndexOf('\\\\'));
		if (pathUrl.slice(-1) == '"' && pathUrl.charAt(0) == '"') pathUrl = replaceAll(pathUrl, '"', '');
		return pathUrl;
	},
	log: log(),
	requestTo: function(deviceName, method, formData, callback) {
		if (!isUrl(deviceName)) deviceName = Win.prefs.httpUrls[deviceName];
		if (typeof formData == 'function') {
			requestify[method.toLowerCase()](deviceName)
				.then(function(response) {
					if (Win.prefs.verbose.requestTo) Win.log('Sent ' + method + ' request to ' + deviceName);
					formData(response.body);
				});
		} else if (typeof method == 'function' || method == undefined) {
			requestify.get(deviceName)
				.then(function(response) {
					if (Win.prefs.verbose.requestTo) Win.log('Sent GET request to ' + deviceName);
					if (method) method(response.body);
				});
		} else {
			requestify[method.toLowerCase()](deviceName, formData)
				.then(function(response) {
					if (Win.prefs.verbose.requestTo) Win.log('Sent ' + method + ' request to ' + deviceName);
					if (callback) callback(response.body);
				});
		}
	},
	speak: speak(),
	error: function(loggedMessage, options) {
		if (loggedMessage !== '' && loggedMessage) {
			if (Win.prefs.log && Win.prefs.log.spokenErrorMessage && !(options && options.silent)) Win.speak(Win.prefs.log.spokenErrorMessage);
			try { throw new Error(loggedMessage); }
			catch (error) {
				Win.log(error.stack, { colour: 'red', background: 'black' });
			}
		}
	},
	cmd: function(command, callback, options) {
		exec('cmd /c ' + command, function(error, stdout, stderr) {
			if (typeof callback == 'object' && options == undefined) {
				options = callback;
				callback = undefined;
			}
			if (stderr && !(options && options.suppressErrors)) Win.error(stderr);
			if (callback) callback(stdout, stderr);
			if (stdout && !(options && options.noLog)) return console.log(stdout);
		});
	},
	PowerShell: (function() {
		let fn = function(command, callback, options) {


			const spawn = require("child_process").spawn;
			let child = spawn("powershell.exe", ["-Command", "-"]);
			child.stdin.setEncoding('utf-8');

			if (options && options.keepAlive && !options.id) Win.error('To keep a PowerShell session active, you must assign it an ID')
			else if (options && options.keepAlive === true && options.id !== undefined) id = options.id;

			function getPowerShellSession(chld) {
				if (chld == undefined) {
					Win.log('Child is not defined (getPowerShellSession). This is a bug with Windows-Interact, please report it along with your setup on github', { colour: 'red' });
					chld = child;
				}
				for (let i in psVars.powerShellSessions) {
					if (typeof child == 'object' && psVars.powerShellSessions[i].child.pid == child.pid) {
						return (psVars.powerShellSessions[i]);
					}
				}
			}

			function getPowerShellSessionById(id) {
				for (let i in psVars.powerShellSessions) {
					if (psVars.powerShellSessions[i].initialOptions.id == id) {
						return (psVars.powerShellSessions[i]);
					} else if (i == psVars.powerShellSessions.length - 1) {
						return undefined;
					}
				}
			}

			function getCommandq(chld) {
				if (chld == undefined) chld = child;
				if (chld == undefined) Win.log('Child is not defined (commandq)', { colour: 'red' })
				return getPowerShellSession(chld).commandq;
			}

			function setParams(cmd, opts, chld) {
				command = cmd;
				options = opts;
				child = chld;
				if (opts.callback) callback = options.callback;
			}

			try {
				let outputTime, errTime;
				if (typeof command == 'string') command = [command];

				function collectOutput(data) {
					clearInterval(outputTime);
					collectErrors(''); // Nudge the error collector in case it's never called

					if (getPowerShellSession(child).commandq[0] == undefined) Win.log('Tried to collect output, but the command queue was empty. This is a bug with Windows-Interact, please report it along with your setup on github', { colour: 'red' })
					if (data.toString() !== '') getPowerShellSession(child).commandq[0].outputBin = getPowerShellSession(child).commandq[0].outputBin + data.toString();

					outputTime = setTimeout(() => {
						pushOutput(child);
					}, 700);
				}

				function collectErrors(data) {
					clearInterval(errTime);
					getCommandq(child)[0].errorBin = getCommandq(child)[0].errorBin + data.toString();

					errTime = setTimeout(() => {
						pushErrors();
					}, 700);
				}

				function pushOutput() {
					getPowerShellSession(child).commandq[0].outputBin = replaceAll(getCommandq(child)[0].outputBin, 'End Win.PowerShell() command\n', '');

					getPowerShellSession(child).out.push(getCommandq(child)[0].outputBin);

					if (getCommandq()[0].outputBin.toString().trim() !== '' && getCommandq().length > 0 && !(getCommandq()[0].options && getCommandq()[0].options.noLog === true) && !(getPowerShellSession(child).initialOptions && getPowerShellSession(child).initialOptions.id && getPowerShellSession(child).initialOptions.id.includes('windows-interact-internal-'))) {
						getCommandq()[0].outputBin = replaceAll(getCommandq()[0].outputBin, 'End Win.PowerShell() command\n', '');
						Win.log((getCommandq().length > 0 && (getCommandq()[0].options && getCommandq()[0].options.keepAlive && getCommandq()[0].options.id) ? '\x1b[33mPowerShell session "' + getCommandq()[0].options.id + '":\x1b[0m\n' : '') + getCommandq()[0].outputBin.toString().trim());
					}
				}

				function pushErrors() {
					if (getCommandq(child)[0].errorBin == '') {
						getPowerShellSession(child).err.push(getCommandq()[0].errorBin);
					} else if (getCommandq()[0].errorBin.trim() !== '\n' && getCommandq()[0].errorBin.trim() !== '\r' && getCommandq()[0].errorBin.trim() !== '\r\n') {
						getPowerShellSession(child).err.push(getCommandq()[0].errorBin.toString().trim());
						if (getCommandq()[0].errorBin.toString().trim() !== '' && getCommandq().length > 0 && !(getCommandq()[0].options && getCommandq()[0].options.suppressErrors == true)) {
							Win.error(getCommandq()[0].errorBin.toString());
						}
					}
					getCommandq()[0].errorBin = '';

					if (getCommandq().length == 1) checkIfDone({ child: child, callback: callback, options: getCommandq(child)[0].options, result: { out: getPowerShellSession(child).out, err: getPowerShellSession(child).err } });

					setTimeout(() => {
						shiftQ();
						runNextInQ();
					}, 800);
				}

				function shiftQ() {
					getPowerShellSession(child).commandq.shift();
				}

				function runNextInQ(chld) {
					if (getCommandq(chld).length > 0) {
						child.stdin.write(`${getCommandq()[0].command + '; write-host "End Win.PowerShell() command";'}\r\n`);
					}
				}

				function qCommand(command, options) {
					if (getPowerShellSession(child) !== undefined && options.existingSession !== true) {
						// If the session already exist, no need to push a new one
						getCommandq(child).push({ command: command, options: options, outputBin: '', errorBin: '' });
					} else if (options && options.id && options.existingSession == true) {
						// If this is for an existing session, find and push it to that session's commandq

						// moved this down to where commands are written
					}
					else if (options && options.id && options.keepAlive == true && options.existingSession == undefined) {
						// If this is for a new session that needs to be kept alive, push it (but with different properties)
						psVars.powerShellSessions.push({
							commandq: [{ command: command, options: options, outputBin: '', errorBin: '' }],
							initialOptions: options,
							out: [],
							err: [],
							child: child,
							end: end,
							newCommand: newCommand,
							triggered: false,
							checkingIfDone: false
						});

					} else if (getPowerShellSession(child) == undefined && !(options && options.keepAlive == true && options.id !== undefined && options.existingSession !== undefined)) {
						// If the session is not stored and it is not going to be kept alive, push it
						psVars.powerShellSessions.push({
							commandq: [{ command: command, options: options, outputBin: '', errorBin: '' }],
							initialOptions: options,
							out: [],
							err: [],
							child: child,
							triggered: false,
							checkingIfDone: false
						});
					}

					if (options && options.id !== undefined && options.existingSession == true && getPowerShellSessionById(options.id) !== undefined) {
						// Wait for the command q to empty out, then write this new command to an existing session

						function when(conditions, callback, delay) {
							function tryit() {
								if (conditions()) callback();
								else {
									setTimeout(() => {
										tryit();
									}, delay);
								}
							}
							tryit();
						}

						// The reason you can't use arrays for newCommands is because of this. It waits for the Q to empty for the target session, then pushes a new command to the q and writes the command. To make it work, I would probably need a backflow Q (stored on the powerShellSession object?) to catch incoming commands, dump them into the main Q when it empties, and then fire runNextInQ so it dominos
						// If I do the above, I would need a way to find and execute other backflow Qs in the order they were received once the main Q finishes

						// Otherwise, I could simple remove the below and find a better way. Maybe get a second opinion on this...
						when(() => {
							for (let i in psVars.powerShellSessions) {
								if (psVars.powerShellSessions[i].initialOptions.id == options.id) {
									if (psVars.powerShellSessions[i].commandq.length == 0) {
										return true;
									} else {
										return false;
									}
								}
							}
						}, () => {
							for (let i in psVars.powerShellSessions) {
								if (psVars.powerShellSessions[i].initialOptions.keepAlive == true) {
									if (psVars.powerShellSessions[i].initialOptions.id == options.id) {

										psVars.powerShellSessions[i].commandq.push({ command: command, options: options, outputBin: '', errorBin: '' });
										setParams(command, options, psVars.powerShellSessions[i].child);

										// Might be a bad place to do this?
										getPowerShellSession(psVars.powerShellSessions[i].child).out = [];
										getPowerShellSession(psVars.powerShellSessions[i].child).err = [];

										setTimeout(() => {
											psVars.powerShellSessions[i].child.stdin.write(`${psVars.powerShellSessions[i].commandq[0].command[0] + '; write-host "End Win.PowerShell() command"'}\r\n`);
										}, 800);

									}
								}
							}
						}, 10);


					} else if (getCommandq(child).length == 1 && getPowerShellSession(child).triggered == false && !(options && options.id && options.existingSession)) {
						// Trigger the Q if this is the first command and this isn't for an existing session
						getPowerShellSession(child).triggered = true;
						runNextInQ();
					}
				}

				child.stdout.on("data", data => {
					collectOutput(data);
				});

				child.stderr.on("data", data => {
					collectErrors(data);
				});

				function end(cb, options, child) {
					child.on('exit', () => {
						if (typeof cb == 'function') cb();
						if (!(options && options.noLog === true)) Win.log(`Ended PowerShell session "${options.id}"`);
					});
					child.stdin.end();
				}

				function newCommand(command, cb, options) {
					if (typeof command == 'string') command = [command];

					if (options == undefined || (options && !options.id)) Win.error('The options parameter and value "id" is required for new commands');

					options.existingSession = true;
					for (let i = 0; i < psVars.powerShellSessions + 1; i++) {
						if (psVars.powerShellSessions[i] && psVars.powerShellSessions[i].initialOptions.keepAlive == true) {
							if (psVars.powerShellSessions[i].initialOptions.id == options.id) {
								// Should this go here? Probably not, it might dump the output of a running command
								/* 
								getPowerShellSession(psVars.powerShellSessions[i].child).out = [];
								getPowerShellSession(psVars.powerShellSessions[i].child).err = []; */
							}
						} else if (psVars.powerShellSessions[i] == undefined) {
							Win.log('Could not find existing powershell session "', options.id, '" even though it should exist and was found previously. This is a problem with Win.PowerShell, please report an issue with details about your setup on GitHub', { colour: 'red' });
							return (undefined);
						}
					}


					for (let i = 0; i < command.length; i++) {
						if (i == command.length - 1) {
							// Last command, should have callback attached
							options.callback = cb;
						}
						qCommand(command, { ...options });
					}
				}

				if ((options && options.id && getPowerShellSessionById(options.id) !== undefined)) {
					Win.log('PowerShell session "' + options.id + '" is already alive. To add a new command to this session, please use Win.PowerShell.newCommand()', { colour: 'yellow' });
				} else {
					for (let i = 0; i < command.length; i++) {
						if (i == command.length - 1) {
							// Last command, should have callback attached 
							if (options && options.callback) options.callback = once(callback);
						}
						qCommand(command[i], options);
					}
				}

				function checkIfDone(data) {
					if (getPowerShellSession(data.child).commandq.length === 0 && getPowerShellSession(data.child).checkingIfDone === false) {
						getPowerShellSession(data.child).checkingIfDone = true;

						if (typeof data.callback == 'function' && (data.result.out.length > 1 || data.result.err.length > 1)) data.callback(data.result.out, data.result.err);
						else if (typeof data.callback == 'function') data.callback(data.result.out.toString(), data.result.err.toString());

						data.callback = undefined;
						callback = undefined;

						if (!(getPowerShellSession(data.child).initialOptions && (getPowerShellSession(data.child).initialOptions.existingSession == true || getPowerShellSession(data.child).initialOptions.keepAlive == true))) {

							getPowerShellSession(data.child).child.stdin.end();
							for (let i in psVars.powerShellSessions) {
								if (psVars.powerShellSessions[i].child.pid == child.pid) {
									psVars.powerShellSessions.splice([i], 1);
									return;
								} else if (i == psVars.powerShellSessions.length - 1) {
									Win.log('Could not find a session to remove. This is likely a problem with Windows-Interact. Please report this as a new issue on github (Thanks!)', { colour: 'yellow' })
								}
							}
						} else if (data.options.keepAlive == true && data.options.existingSession !== true) {
							if (isVerbose('PowerShell') && !data.options.id.includes('windows-interact-internal-')) Win.log('PowerShell session will be kept alive. ID: "' + options.id + '"', { colour: 'yellow' });
						}
						getPowerShellSession(data.child).out = [];
						getPowerShellSession(data.child).err = [];
						getPowerShellSession(data.child).checkingIfDone = false, getPowerShellSession(data.child).triggered = false;
					} else {
						setTimeout(() => {
							checkIfDone(data);
						}, 10);
					}
				}


			} catch (err) {
				console.trace(err)
				//Win.error(err);
			}
		}

		fn.newCommand = function(command, callback, options) {

			tryForUntil(10, 1500, `(function() {
							for (let i in psVars.powerShellSessions) {
								if (psVars.powerShellSessions[i].initialOptions.id == "${options.id}") {
									return true;
								} else if (i == psVars.powerShellSessions.length - 1) {
									return false;
								}
							}
						})()`, () => {
					if ((function() {
						for (let i in psVars.powerShellSessions) {
							if (psVars.powerShellSessions[i].initialOptions.id == options.id) {
								return true;
							} else if (i == psVars.powerShellSessions.length - 1) {
								return false;
							}
						}
					})()) {
						(once(() => {
							for (let i = 0; i < psVars.powerShellSessions.length; i++) {
								if (psVars.powerShellSessions[i].initialOptions.id = options.id) {

									psVars.powerShellSessions[i].newCommand(command, callback, options);
									i = psVars.powerShellSessions.length;
								}
							}
						}))();
					} else {
						if (isVerbose('PowerShell')) Win.log('Could not find PowerShell session "' + options.id + '". Retrying...', { colour: 'yellow' });
					}
				}, () => {
					if (isVerbose('PowerShell')) Win.log('No PowerShell sessions are alive', { colour: 'yellow' });
				}, () => {
					//if (isVerbose('PowerShell')) Win.log(`PowerShell session "${options.id}" found!`, { colour: 'yellow' });
				});
		}

		fn.isSessionActive = function(id, callback) {
			for (let i in psVars.powerShellSessions) {
				if (psVars.powerShellSessions[i] && psVars.powerShellSessions[i].initialOptions && psVars.powerShellSessions[i].initialOptions.id == id) {
					callback(true);
				} else if (i == psVars.powerShellSessions.length - 1) {
					callback(false);
				}
			}
		}

		fn.endSession = function(id, callback) {
			for (let i in psVars.powerShellSessions) {
				if (psVars.powerShellSessions[i].id == id) {
					psVars.powerShellSessions[i].end(callback, psVars.powerShellSessions[i].initialOptions, psVars.powerShellSessions[i].child);
				}
			}
		}

		return fn;
	})(),
	notify: function(message, title, image) {
		if (message == undefined) {
			Win.error('Cannot send notification. No message was given');
		} else {
			if (Number(require('os').release().substr(0, 2)) < 10) {
				// Anything below Windows 10
				nircmd('trayballoon "' + ((!title) ? ' ' : message) + '" "' + ((title) ? title : message) + (image ? `" "${image}"` : '" "c:\\"'));
			} else {
				Win.PowerShell(['Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Unrestricted', 'Unblock-File -Path .\\Notify.ps1', `.\\Notify.ps1 "${(title ? title : 'Node.js')}" "${message}" "${replaceAll(image, '\\\\', '\\')}"`], undefined, { noLog: true, suppressErrors: true });
			}
		}
	},
	confirm: function(message, title) {
		return new Promise(resolve => {
			Win.PowerShell('$wshell = New-Object -ComObject Wscript.Shell;$wshell.Popup("' + (message) + '",0,"' + ((!title) ? 'Node' : title) + '",0x1)', function(stdout) {
				resolve((stdout.trim() == '1') ? true : false);
			}, { noLog: true });
		});

	},
	alert: function(message, title) {
		return new Promise(resolve => {
			if (message && message.trim() !== '') {
				Win.PowerShell(`$wshell = New - Object - ComObject Wscript.Shell
				$wshell.Popup("${message}", 0, "${((!title) ? 'Node' : title)}")`, () => {
						resolve();
					});
				nircmd('infobox "' + (message) + '" "' + ((!title) ? 'Node' : title) + '"', () => {

				});
			}
		});
	},
	prompt: function(message, title, placeholder) {
		return new Promise(resolve => {
			Win.PowerShell(`Add - Type - AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.Interaction]:: InputBox('` + message + `', '` + ((title) ? title : `Node`) + `', '` + ((placeholder) ? placeholder : ``) + `')`, (response) => {
				resolve(response.trim());
			}, { noLog: true });
		});
	},
	appManager: {
		registeredApps: {},
		register: (function() {

			let fn = function(obj) {
				let registrationComplete = false;

				Object.entries(obj).forEach(([appName, props]) => {
					if (appName == undefined) Win.error('Name not defined for registered app. You need to define a name and path to the application.');
					else if (props.path == undefined && appName) Win.error('Path not defined for registered app: ' + appName);

					props.id = Object.keys(Win.appManager.registeredApps).length + 1;
					Win.appManager.registeredApps[appName] = props;
					Win.appManager.registeredApps[appName].name = appName;

					//Handle and parse app path 
					let appPath = Win.appManager.registeredApps[appName].path;
					if (!(appPath.slice(-1) == '"' && appPath.charAt(0) == '"')) appPath = '"' + appPath + '"';
					Win.appManager.registeredApps[appName].path = appPath;

					//Handle and parse process name 
					let processName = appPath.substr(appPath.lastIndexOf(`\\\\`));
					processName = replaceAll(processName, '\\\\', '');
					processName = replaceAll(processName, '"', '');
					Win.appManager.registeredApps[appName].processName = processName;

					if (Win.appManager.registeredApps[appName].onKill) {
						Win.appManager.registeredApps[appName].onKill = debounce(Win.appManager.registeredApps[appName].onKill, Win.prefs.appManagerRefreshInterval);
					}
					if (Win.appManager.registeredApps[appName].onLaunch) {
						Win.appManager.registeredApps[appName].onLaunch = debounce(Win.appManager.registeredApps[appName].onLaunch, Win.prefs.appManagerRefreshInterval);
					}

					apps.push(replaceAll(processName, '.exe', ''));
				});

				function setIsRunning(processName, bool) {
					for (let i in Win.appManager.registeredApps) {
						if (Win.appManager.registeredApps[i].path.includes(processName)) {
							Win.appManager.registeredApps[i].isRunning = bool;
						} else if (i == Win.appManager.registeredApps.length) {
							Win.appManager.registeredApps[i].isRunning = null;
						}
					}
				}

				function setWasRunning(processName, bool) {
					for (let i in Win.appManager.registeredApps) {
						if (Win.appManager.registeredApps[i].path.includes(processName)) {
							Win.appManager.registeredApps[i].wasRunning = bool;
						} else if (i == Win.appManager.registeredApps.length) {
							Win.appManager.registeredApps[i].wasRunning = null;
						}
					}
				}

				function getIsRunning(processName) {
					for (let i in Win.appManager.registeredApps) {
						if (Win.appManager.registeredApps[i].path.includes(processName) && Win.appManager.registeredApps[i].isRunning !== undefined) {
							return Win.appManager.registeredApps[i].isRunning;
						} else if (i == Win.appManager.registeredApps.length) {
							return false;
						}
					}
				}

				function getWasRunning(processName) {
					for (let i in Win.appManager.registeredApps) {
						if (Win.appManager.registeredApps[i].path.includes(processName) && Win.appManager.registeredApps[i].wasRunning !== undefined) {
							return Win.appManager.registeredApps[i].wasRunning;
						} else if (i == Win.appManager.registeredApps.length) {
							return false;
						}
					}
				}

				function getNameByProcessName(processName) {
					for (let i in Win.appManager.registeredApps) {
						if (Win.appManager.registeredApps[i].path.includes(processName)) {
							return Win.appManager.registeredApps[i].name.toString();
						}
					}
				}

				function appWatchProcessing(stdout) {
					for (let i in apps) {
						let appName = apps[i];
						if (stdout.includes(appName)) {
							setIsRunning(appName, true);
							setTimeout(() => {
								setWasRunning(appName, true);
							}, (Win.prefs.appManagerRefreshInterval ? Win.prefs.appManagerRefreshInterval / 2 : 2500));
						} else {
							setIsRunning(appName, false);
							setTimeout(() => {
								setWasRunning(appName, false);
							}, (Win.prefs.appManagerRefreshInterval ? Win.prefs.appManagerRefreshInterval / 2 : 2500));
						}

						if (!getIsRunning(appName) && getWasRunning(appName) && Win.appManager.registeredApps[getNameByProcessName(appName)].onKill) {
							Win.appManager.registeredApps[getNameByProcessName(appName)].onKill();
						}
						if (!getIsRunning(appName) && getWasRunning(appName)) {
							for (let i in groups) {
								Object.entries(groups[i]).forEach(([groupName, props]) => {
									if (groups[i][groupName].apps.includes(getNameByProcessName(appName)) && groups[i][groupName].onKill) {
										groups[i][groupName].onKill = debounce(groups[i][groupName].onKill, 2000, true);
										groups[i][groupName].onKill();
									}
								});
							}
						}

						if (!registrationComplete) registrationComplete = true;

						if (registrationComplete && getIsRunning(appName) && !getWasRunning(appName) && Win.appManager.registeredApps[getNameByProcessName(appName)].onLaunch) {
							Win.appManager.registeredApps[getNameByProcessName(appName)].onLaunch();
						}

						if (registrationComplete && getIsRunning(appName) && !getWasRunning(appName)) {
							for (let i in groups) {
								Object.entries(groups[i]).forEach(([groupName, props]) => {
									if (groups[i][groupName].apps.includes(getNameByProcessName(appName)) && groups[i][groupName].onLaunch) {
										groups[i][groupName].onLaunch = debounce(groups[i][groupName].onLaunch, 2000, true);
										groups[i][groupName].onLaunch();
									}
								});
							}
						}

						windowTitle = replaceAll(stdout, '\r\nProcessName', '');
						windowTitle = replaceAll(windowTitle, 'MainWindowTitle', '');
						windowTitle = windowTitle.replace(/(-{5,})/g, '');
						windowTitle = windowTitle.replace(/(\w+)([^\w]\s{2})/g, '');
						windowTitle = windowTitle.trim();

						Win.appManager.registeredApps[getNameByProcessName(appName)].windowTitle = windowTitle;
					}
				}

				Win.appManager.appWatcher = function() {
					Win.PowerShell.isSessionActive('windows-interact-internal-appWatcher', result => {
						if (!result) {
							Win.PowerShell('get-process "' + apps.join('", "') + '" | select ProcessName, MainWindowTitle', (stdout) => {
								appWatchProcessing(stdout);
							}, { noLog: true, suppressErrors: true, keepAlive: true, id: 'windows-interact-internal-appWatcher' });
						} else {
							Win.PowerShell.newCommand('get-process "' + apps.join('", "') + '" | select ProcessName, MainWindowTitle', (stdout) => {
								appWatchProcessing(stdout);
							}, { noLog: true, suppressErrors: true, keepAlive: true, id: 'windows-interact-internal-appWatcher' });
						}
					});


					setTimeout(() => {
						Win.appManager.appWatcher();
					}, (Win.prefs.appManagerRefreshInterval ? Win.prefs.appManagerRefreshInterval : 2500));

				};
				Win.appManager.appWatcher();
			}


			fn.group = function(obj) {
				Object.entries(obj).forEach(([groupName, props]) => {
					let entry = new Object;
					entry[groupName] = props;
					groups.push(entry);
				});
			};

			return fn;
		})(),
		launch: (function() {
			let fn = function(appName) {
				if (!Win.appManager.registeredApps[appName]) {
					Win.error('Unable to launch requested application. The requested app is either not registered or misspelled');
				} else {
					nircmd('execmd ' + Win.appManager.registeredApps[appName].path);
					if (Win.appManager.registeredApps[appName].onLaunch) Win.appManager.registeredApps[appName].onLaunch();
				}
			}

			fn.group = function(groupName) {
				for (let i in groups) {
					if (groups[i][groupName] !== undefined) {
						for (let o in groups[i][groupName].apps) {
							Win.appManager.launch(groups[i][groupName].apps[o]);
						}

					}
				}
			}

			return fn;
		})(),
		kill: (function() {
			let fn = function(appName) {
				if (!Win.appManager.registeredApps[appName]) {
					Win.error('Unable to kill requested application. The requested app is either not registered or misspelled');
				} else {
					Win.process.kill(Win.appManager.registeredApps[appName].processName);
					if (Win.appManager.registeredApps[appName].onKill) Win.appManager.registeredApps[appName].onKill();
				}
			}
			fn.group = function(groupName) {
				for (let i in groups) {
					if (groups[i][groupName] !== undefined) {
						for (let o in groups[i][groupName].apps) {
							Win.appManager.kill(groups[i][groupName].apps[o]);
						}

					}
				}
			}
			return fn;
		})(),
		hide: function(appName) {
			for (let i in Win.appManager.registeredApps) {
				if (Win.appManager.registeredApps[i].name == appName) {
					nircmd('win hide process "' + Win.appManager.registeredApps[i].processName + '"');
				}
			}
			
		},
		switchTo: function(appName) {
			if (Win.appManager.registeredApps[appName] !== undefined || Win.appManager.registeredApps[appName].windowTitle !== undefined) {
				Win.PowerShell('$myshell = New-Object -com "Wscript.Shell"; $myshell.AppActivate("' + Win.appManager.registeredApps[appName].windowTitle + '")', (stdout) => {
					if (stdout.includes('False')) {
						if(isVerbose('appManager')) Win.log('Could not find app by windowTitle. Using process name as fallback to switch to app. This may not be as accurate', {colour: 'yellow'});
						nircmd('win activate process "' + Win.appManager.registeredApps[appName].processName + '"');
					}
				}, { noLog: true });
			} else {
				Win.error('Could not find Window title or process of requested app "' + appName + '". The app may not be running or registered.');
			}
		}
	},
	process: {
		hide: function(processName) {
			nircmd('win hide process "' + processName + '"');
		},
		getPid: function(processName, callback) {
			return new Promise(resolve => {
				Win.PowerShell('get-process -ProcessName "' + replaceAll(processName, '.exe', '') + '" | Format-Table id', (stdout, stderr) => {
					stdout = replaceAll(stdout, 'Id', '');
					stdout = replaceAll(stdout, '--', '');
					stdout = replaceAll(stdout, '\r', '');
					stdout = stdout.trim();
					stdout = stdout.split('\n');
					stdout = stdout.filter(String);
					if (callback) callback((!stdout.length ? false : stdout));
					resolve((!stdout.length ? false : stdout));
				}, { noLog: true, suppressErrors: true });
			});
		},
		kill: function(nameOrPid) {
			return new Promise(resolve => {
				if (nameOrPid !== '' && nameOrPid !== undefined && nameOrPid !== null) {
					Win.cmd('taskkill /F /IM "' + nameOrPid + '"', () => {
						resolve();
					}, { suppressErrors: true, noLog: true });
				}
			});
		},
		onKill: function(appName, callback) {
			Win.PowerShell('Wait-Process -Name ' + appName, function(stdout, stderr) {
				if (stderr) {
					setTimeout(() => {
						Win.process.onKill(appName, callback);
					}, 3000);
				}
				else {
					callback();
				}
			}, { noLog: true, suppressErrors: true });
		},
		getWindowTitle: function(processName, callback) {
			return new Promise(resolve => {
				Win.PowerShell('get-process "' + replaceAll(processName, '.exe', '') + '" | select MainWindowTitle', function(stdout) {
					output = '' + stdout;
					output = replaceAll(output, 'MainWindowTitle', '');
					output = replaceAll(output, '---------------', '');
					output = output.trim();
					if (output == '') output = false;
					if (callback) callback(output);
					resolve(output);
				}, { noLog: true, suppressErrors: true });
			});
		},
		getPidByWindowTitle: function(windowTitle, callback) {
			return new Promise(resolve => {
				Win.PowerShell('get-process | select ID, MainWindowTitle', stdout => {
					if (stdout.includes(windowTitle)) {

						stdout = replaceAll(stdout, ',', '');
						stdout = stdout.split('\r\n');
						for (let i in stdout) {
							if (stdout[i].includes(windowTitle)) {
								resolve(stdout[i].replace(/[^0-9]/g, ""));
								if (typeof callback == 'function') callback(stdout[i].replace(/[^0-9]/g, ""));
							}
						}
					} else {
						Win.error('Window title not found');
						if (typeof callback == "function") {
							callback(undefined);
							resolve(undefined);
						}
					}
				}, { noLog: true, suppressErrors: true });
			});
		},
		isRunning: function(processName, callback) {
			return new Promise(resolve, reject => {
				try {
					Win.PowerShell('get-process "' + processName + '" | select ProcessName', (stdout) => {
						if (stdout.includes(processName)) {
							callback(true); resolve(true);
						} else {
							callback(false); resolve(false);
						}
					}, { noLog: true, suppressErrors: true });
				} catch (error) {
					Win.error(error);
					callback(false);
					reject(error);
				}
			});
		}
	},
	get: {
		audioDevices: {
			list: callback => {
				Win.PowerShell('Get-AudioDevice -List', (result) => {
					result = replaceAll(result, ',', '')
					devices = result.split('Index   :');
					devices.shift();

					for (let i in devices) {
						value = devices[i];
						devices[i] = {};
						devices[i].type = value.substring(value.indexOf('\r\nType    : ') + 12, value.indexOf('\r\nName'));
						devices[i].name = value.substring(value.indexOf('Name') + 10, value.indexOf(' ('));
						devices[i].index = value.substring(1, 2);
					}

					for (let i in devices) {
						if (devices[i].type.includes('Recording')) devices[i].type = 'input';
						else if (devices[i].type.includes('Playback')) devices[i].type = 'output';
					}

					if (typeof callback == 'function') callback(devices);
				}, { noLog: true });
			},
			output: {
				default: callback => {
					Win.PowerShell('Get-AudioDevice -Playback', (result) => {
						result = result.substring(result.indexOf('Name'), result.lastIndexOf('ID') - 1);
						result = result.substring(result.indexOf(':') + 2, result.indexOf('(') - 1);
						if (typeof callback == 'function') callback(result);
					}, { noLog: true });
				},
				volume: callback => {
					Win.PowerShell('Get-AudioDevice -PlaybackVolume', result => {
						callback(result.trim());
					}, { noLog: true });
				},
				muteState: callback => {
					Win.PowerShell('Get-AudioDevice -PlaybackMute', result => {
						callback(result.toLowerCase() == 'true');
					}, { noLog: true });
				},
				isPlaying: callback => {
					Win.PowerShell(supplementals.AudioDetection, result => {
						//console.log(result);
						if (result.trim() == 'True') {
							callback(true);
						} else {
							callback(false);
						}
					}, { noLog: true });
				}
			},
			input: {
				default: callback => {
					Win.PowerShell('Get-AudioDevice -Recording', (result) => {
						result = result.substring(result.indexOf('Name'), result.lastIndexOf('ID') - 1);
						result = result.substring(result.indexOf(':') + 2, result.indexOf('(') - 1);
						if (typeof callback == 'function') callback(result);
					}, { noLog: true });
				},
				volume: callback => {
					Win.PowerShell('Get-AudioDevice -RecordingVolume', result => {
						callback(result.trim());
					}, { noLog: true });
				},
				muteState: callback => {
					Win.PowerShell('Get-AudioDevice -RecordingMute', result => {
						callback(result.toLowerCase() == 'true');
					}, { noLog: true });
				}
			}
		}
	},
	set: {
		audioDevices: {
			output: {
				volume: function(vol) {
					nircmd('setsysvolume ' + Math.floor(vol * 665.35));
				},
				default: function(device) {
					nircmd('setdefaultsounddevice "' + device + '"');
				},
				mute: function(bool) {
					Win.PowerShell('Set-AudioDevice -PlaybackMute ' + bool);
				}
			},
			input: {
				volume: function(vol) {
					Win.PowerShell('Set-AudioDevice -RecordingVolume ' + vol);
				},
				default: function(device) {
					nircmd('setdefaultsounddevice "' + device + '"');
				},
				mute: function(bool) {
					Win.PowerShell('Set-AudioDevice -RecordingMute ' + bool);
				}
			}
		},
		preferences: function(object) {
			for (let property in object) {
				if (object.hasOwnProperty(property)) {
					Win.prefs[property] = object[property];
				}
			}
		},
	},
	power: {
		shutdown: function(delay) {
			Win.cmd('shutdown.exe /s /t ' + ((delay) ? delay : 0));
		},
		restart: function(delay) {
			Win.cmd('shutdown.exe /r /t ' + ((delay) ? delay : 0));
		},
		lock: function(delay) {
			setTimeout(() => {
				Win.cmd('rundll32.exe user32.dll,LockWorkStation');
			}, ((delay) ? delay : 0));
		},
		sleep: function(delay) {
			setTimeout(() => {
				Win.PowerShell(['cd ' + Win.path`${__dirname} `, '\\nircmd.exe standby']);
			}, ((delay) ? delay : 0));
		},
		screenSaver: function(delay) {
			setTimeout(() => {
				Win.PowerShell(['cd ' + Win.path`${__dirname} `, '\\nircmd.exe screensaver']);
			}, ((delay) ? delay : 0));
		}
	},
	window: {
		minimize: function(processName) {
			if (processName !== undefined) {
				if (!processName.includes('.exe')) processName = processName + '.exe';
				Win.PowerShell(['cd ' + Win.path`${__dirname} `, '\\nircmd.exe win min process "' + processName + '"']);
			} else {
				nircmd('win min foreground');
			}
		},
		maximize: function(processName) {
			if (processName !== undefined) {
				if (!processName.includes('.exe')) processName = processName + '.exe';
				nircmd('win max process "' + processName + '"');
			} else {
				nircmd('win max foreground');
			}
		},
		restore: function(processName) {
			if (processName !== undefined) {
				if (!processName.includes('.exe')) processName = processName + '.exe';
				nircmd('win normal process "' + processName + '"');
			} else {
				nircmd('win normal foreground');
			}
		},
		resize: function(width, height, processName) {
			if (isNaN(height)) Win.error('Cannot resize: Invalid or no height was specified');
			if (isNaN(height)) Win.error('Cannot resize: Invalid or no width was specified');

			if (processName !== undefined && isNaN(height) === false && isNaN(width) === false) {
				if (!processName.includes('.exe')) processName = processName + '.exe';
				Win.window.restore(processName);
				Win.PowerShell(['cd ' + Win.path`${__dirname} `, '\\nircmd.exe win setsize process "' + processName + '" x y ' + width + ' ' + height], { suppressErrors: true, noLog: true });
			} else {
				nircmd('win setsize foreground x y ' + width + ' ' + height, undefined, { supressErrors: true, noLog: true });
			}
		},
		move: function(x, y, processName) {
			if (isNaN(x)) Win.error('Cannot resize: Invalid or no height was specified');
			if (isNaN(y)) Win.error('Cannot resize: Invalid or no width was specified');

			if (processName !== undefined && isNaN(x) === false && isNaN(y) === false) {
				if (!processName.includes('.exe')) processName = processName + '.exe';
				Win.window.restore(processName);
				nircmd('win move process "' + processName + '" ' + x + ' ' + y, undefined, { suppressErrors: true, noLog: true });
			} else {
				nircmd('win setsize foreground x y ' + width + ' ' + height, undefined, { supressErrors: true, noLog: true });
			}
		}
	},
	showDesktop: function() {
		Win.PowerShell('(New-Object -ComObject shell.application).toggleDesktop()');
	},
	screenshot: function(region, path) {
		if (path == undefined) {
			path = '*clipboard*';
		} else path = '"' + path + '"';

		if (region == 'full') nircmd('savescreenshotfull ' + path);
		else if (region == 'window') nircmd('savescreenshotwin ' + path);
	},
	playAudio: function(path) {
		path = replaceAll(path, '\\\\', '\\');
		if (path.includes('.wav')) {
			Win.PowerShell([`$soundplayer = New - Object Media.SoundPlayer '` + path + `'`, ` $soundplayer.Play(); `], null, { keepAlive: true });
		} else {
			Win.PowerShell(`Add - Type - AssemblyName presentationCore;
										$mediaPlayer = New - Object System.Windows.Media.MediaPlayer;
										$mediaPlayer.open("${path}");
										$mediaPlayer.Play()`, undefined, { keepAlive: true, noLog: true });
		}
	},
	stopAudio: function(path) {
		for (let i in psVars.powerShellSessions) {
			if (psVars.powerShellSessions[i].command[0].includes(replaceAll(path, '\\\\', '\\'))) {
				if (path.includes('.wav')) {
					psVars.powerShellSessions[i].newCommand(`$soundplayer.Stop()`);
					psVars.powerShellSessions[i].end();
				} else psVars.powerShellSessions[i].end();
			}
		}
	},
	filePicker: function(windowTitle, initialDirectory, filter, allowMultiSelect, callback) {
		if (filter && filter.filterby && typeof filter.filterby == 'string' && filter.filterby.charAt(0) == '.') filter.filterby = '*' + filter.filterby;
		if (filter && filter.filterby && !filter.filtertext) filter.filtertext = filter.filterby + ' files';
		if (filter && (typeof filter.filterby == 'object' || typeof filter.filterby == 'array')) {
			for (let i in filter.filterby) {
				if (filter.filterby[i].charAt(0) == '.') filter.filterby[i] = '*' + filter.filterby[i];
			}
			filter.filterby = filter.filterby.join(';');
		}

		Win.PowerShell([`
										function Read-OpenFileDialog([string]$WindowTitle, [string]$InitialDirectory, [string]$Filter = "All files (*.*)|*.*", [switch]$AllowMultiSelect)
		{
								Add-Type - AssemblyName System.Windows.Forms
			$openFileDialog = New - Object System.Windows.Forms.OpenFileDialog
			$openFileDialog.Title = $WindowTitle
			if(![string]:: IsNullOrWhiteSpace($InitialDirectory)) { $openFileDialog.InitialDirectory = $InitialDirectory }
						$openFileDialog.Filter = $Filter
						if ($AllowMultiSelect) { $openFileDialog.MultiSelect = $true }
						$openFileDialog.ShowHelp = $true	# Without this line the ShowDialog() function may hang depending on system configuration and running from console vs.ISE.
							$openFileDialog.ShowDialog() > $null
						if ($AllowMultiSelect) { return $openFileDialog.Filenames } else { return $openFileDialog.Filename }
					} `,
			`
					$filePath = Read - OpenFileDialog - WindowTitle "${(windowTitle ? windowTitle : `Select a File`)}" - InitialDirectory '${(initialDirectory ? replaceAll(initialDirectory, '\\\\', '\\') : `C:\\`)}' ${(filter && filter.filtertext && filter.filterby) ? `-Filter "${filter.filtertext} (${filter.filterby})|${filter.filterby}"` : ''} ${(allowMultiSelect ? `-AllowMultiSelect` : '')}; if (![string]:: IsNullOrEmpty($filePath)) { Write - Host "$filePath" } else { "No file was selected" }
						`], result => {
				if (typeof callback == 'function') callback(result[0].includes('No file was selected') ? undefined : result[0]);
			}, { noLog: true });
	},
	toggleMediaPlayback: function() {
		nircmd('sendkeypress 0xB3');
	}
}

module.exports = Win;
