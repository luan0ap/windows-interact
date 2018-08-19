const exec = require('child_process').exec;
const fs = require('fs');
const say = require('say');
const requestify = require('requestify');
let prefs = {};
let powerShellSessions = [];

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

async function tryForUntil(tries, delay, func, conditions, notMetCallback) {
	for (let i = 0; i < tries; i++) {
		await (() => {
			return new Promise(resolve => {
				setTimeout(() => {
					func();
					resolve();
					if (eval(conditions)) {
						console.log('conditions met')
					} else if (i == tries - 1) {
						notMetCallback();
					}
				}, delay);
			});
		})();
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
	Win.PowerShell(['cd ' + Win.path`${__dirname}`, '.\\nircmd ' + command], callback, options ? options : { noLog: true });
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
			if (typeof callback == 'object' && options == undefined) {
				options = callback;
				callback = undefined;
			}
			if (options && options.keepAlive && !options.id) Win.error('To keep a PowerShell session active, you must assign it an ID')
			else if (options && options.keepAlive && options.id) id = options.id;

			function getPowerShellSession(cb) {
				for (let i in powerShellSessions) {
					if (powerShellSessions[i].id == options.id) {
						cb(powerShellSessions[i]);
					} else if (i == powerShellSessions.length) {
						cb()
					}
				}
			}

			try {
				let self = { out: [], err: [] }, id, commandq = [];
				let checkingIfDone = false, triggered = false;
				let outputBin = '', errorBin = '';
				const spawn = require("child_process").spawn;
				const child = spawn("powershell.exe", ["-Command", "-"]);
				child.stdin.setEncoding('utf-8');

				if (typeof command == 'string') command = [command];

				function collectOutput(data) {
					if (data.toString() !== '') outputBin = outputBin + data.toString();
				}

				function collectErrors(data) {
					if (data.toString() !== '') errorBin = errorBin + data.toString();
				}

				function pushOutput() {
					if (errorBin.trim() !== '') pushErrors();
					if (outputBin !== '\n' && outputBin !== '\r' && outputBin !== '\r\n' && outputBin !== '') self.out.push(outputBin);

					if (outputBin.toString().trim() !== '' && commandq.length > 0 && (!(commandq[0].options && commandq[0].options.noLog))) {
						Win.log((commandq.length > 0 && (commandq[0].options && commandq[0].options.keepAlive && commandq[0].options.id) ? 'PowerShell Session "' + commandq[0].options.id + '":\n' : '') + outputBin.toString());
					}
					outputBin = '';

					(once(checkIfDone()))();
					shiftQ();
					if (commandq.length > 0) runNextInQ();
				}

				function pushErrors() {
					if (errorBin == '') {
						self.err.push(errorBin);
					} else if (errorBin.trim() !== '\n' && errorBin.trim() !== '\r' && errorBin.trim() !== '\r\n') {
						self.err.push(errorBin.toString());
						if (errorBin.toString().trim() !== '' && commandq.length > 0 && !(commandq[0].options && commandq[0].options.suppressErrors)) {
							Win.error(errorBin.toString());
						}
					}
					errorBin = '';

					(once(checkIfDone()))();
					shiftQ();
					if (commandq.length > 0) runNextInQ();
				}

				function shiftQ() {
					commandq.shift();
				}

				shiftQ = debounce(shiftQ, 800, true);

				function runNextInQ() {
					setTimeout(() => {
						child.stdin.write(`${commandq[0].command}\r\n`);
					}, 800);
				}

				function qCommand(command) {
					commandq.push({ command, options });
					if (commandq.length == 1 && triggered == false) {
						triggered = true;
						runNextInQ();
					}
				}

				collectOutputUntilDelay = postbounce(collectOutput, 800, pushOutput);
				collectErrorsUntilDelay = postbounce(collectErrors, 800, pushErrors);

				child.stdout.on("data", data => {
					collectOutputUntilDelay(data);
				});

				child.stderr.on("data", data => {
					collectErrorsUntilDelay(data);
				});

				function end(cb) {
					child.on('exit', () => {
						if (typeof cb == 'function') cb();
					});
					if (!(options && options.noLog)) Win.log(`Ended PowerShell session "${options.id}"`);
					child.stdin.end();
				}

				function newCommand(command, id, cb) {
					if (typeof command == 'array' || typeof command == 'object') {
						Win.log('For now, newCommands for existing PowerShell sessions must be a single command, not an array. Your array will be joined with a "; " and executed, but the output for all commands will be returned as a single string', { colour: 'yellow' });
						command = command.join('; ');
					}

					for (let i in powerShellSessions) {
						if (powerShellSessions[i].id == options.id) {
							powerShellSessions[i].child.stdin.write(`${command}\n\r`);

							let output = '';
							function collectOutput(data) {
								output = output + data.toString();
							}
							collectOutput = postbounce(collectOutput, 30, () => {
								(once(cb(output)))();
							});
							powerShellSessions[i].child.stdout.on("data", data => {
								collectOutput(data);
							});
							powerShellSessions[i].results = { output: self.out, errors: self.err };
						}
					}
				}

				for (let i in command) {
					qCommand(command[i]);
				}

				function checkIfDone() {
					//console.log(commandq);
					if (commandq.length === 0 && command.length > 0 && checkingIfDone === false) {
						checkingIfDone = true;
						setTimeout(() => {
							if (typeof callback == 'function' && command.length > 1) callback(self.out, self.err);
							else if (typeof callback == 'function') callback(self.out.toString(), self.err.toString());
							if (!(options && options.keepAlive && options.id)) {
								child.stdin.end();
								checkingIfDone = false;
							} else {
								if (options && options.noLog) Win.log('PowerShell process is being kept alive. ID: "' + options.id + '"', { colour: 'yellow' });

								powerShellSessions.push({
									command: command,
									child: child,
									id: options.id,
									end: end,
									newCommand: newCommand,
									results: { output: self.out, errors: self.err }
								});
								checkingIfDone = false;
							}
						}, 800); // wait a bit to let the last command finish outputting

					} else {
						setTimeout(() => {
							checkIfDone();
						}, 50);
					}
				}
			} catch (err) {
				Win.error(err);
			}
		}

		fn.newCommand = function(id, command, callback) {
			callback = once(callback);

			tryForUntil(10, 1000, () => {
				if ((function() {
					for (let i in powerShellSessions) {
						if (powerShellSessions[i].id == id) {
							return true;
						} else if (i == powerShellSessions.length - 1) {
							return false;
						}
					}
				})()) {
					once(() => {
						for (let i in powerShellSessions) {
							if (powerShellSessions[i].id = id) {
								powerShellSessions[i].newCommand(command, id, (output, err) => {
									if (typeof callback == 'function') callback(output, err);
								});
								break;
							}
						}
					});
				} else {
					Win.log('Could not find PowerShell session "' + id + '". Retrying...', { colour: 'yellow' });
				}

			}, (powerShellSessions.length > 1), () => {
				Win.log('No PowerShell sessions are alive', { colour: 'yellow' });
			});
		}

		fn.endSession = function(id, callback) {
			for (let i in powerShellSessions) {
				if (powerShellSessions[i].id == id) {
					powerShellSessions[i].end(callback);
				}
			}
		}

		return fn;
	})(),
	notify: function(message, title) {
		if (message == undefined) Win.error('Cannot send notification. No message was given');
		nircmd('trayballoon "' + ((!title) ? ' ' : message) + '" "' + ((title) ? title : message) + '" "c:\\"');
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
				nircmd('infobox "' + (message) + '" "' + ((!title) ? 'Node' : title) + '"', () => {
					resolve();
				});
			}
		});
	},
	prompt: function(message, title, placeholder) {
		return new Promise(resolve => {
			Win.PowerShell(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('` + message + `' , '` + ((title) ? title : `Node`) + `' , '` + ((placeholder) ? placeholder : ``) + `')`, (response) => {
				resolve(response)
			}, { noLog: true });
		});
	},
	appManager: {
		registeredApps: {},
		register: function(obj) {
			let apps = [];
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

			Win.appManager.appWatcher = function() {
				Win.PowerShell('get-process "' + apps.join('", "') + '" | select ProcessName, MainWindowTitle', (stdout) => {
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

						if (!getIsRunning(appName) && getWasRunning(appName) && Win.appManager.registeredApps[appName].onKill) Win.appManager.registeredApps[getNameByProcessName(appName)].onKill();
						if (!registrationComplete) registrationComplete = true;
						if (registrationComplete && getIsRunning(appName) && !getWasRunning(appName) && Win.appManager.registeredApps[getNameByProcessName(appName)].onLaunch) Win.appManager.registeredApps[getNameByProcessName(appName)].onLaunch();

						windowTitle = stdout.substr(stdout.lastIndexOf('\n' + appName));
						windowTitle = windowTitle.substring(0, windowTitle.indexOf('\r'));
						windowTitle = replaceAll(windowTitle, appName, '').trim();
						if (windowTitle == '') windowTitle = null;

						for (let i in Win.appManager.registeredApps) {
							if (Win.appManager.registeredApps[i].path.includes(appName)) {
								return Win.appManager.registeredApps[i].windowTitle = windowTitle;
							}
						}
						Win.appManager.registeredApps[appName].windowTitle = windowTitle;
					}
				}, { noLog: true, suppressErrors: true });

				setTimeout(() => {
					Win.appManager.appWatcher();
				}, (Win.prefs.appManagerRefreshInterval ? Win.prefs.appManagerRefreshInterval : 3000));


			};
			Win.appManager.appWatcher();

		},
		launch: function(appName) {
			if (!Win.appManager.registeredApps[appName]) {
				Win.error('Unable to launch requested application. The requested app is either not registered or misspelled');
			} else {
				nircmd('execmd ' + Win.appManager.registeredApps[appName].path);
				if (Win.appManager.registeredApps[appName].onLaunch) Win.appManager.registeredApps[appName].onLaunch();
			}
		},
		kill: function(appName) {
			if (!Win.appManager.registeredApps[appName]) {
				Win.error('Unable to kill requested application. The requested app is either not registered or misspelled');
			} else {
				Win.process.kill(Win.appManager.registeredApps[appName].processName);
				if (Win.appManager.registeredApps[appName].onKill) Win.appManager.registeredApps[appName].onKill();
			}
		},
		hide: function(processName) {
			nircmd('win hide process "' + processName + '"');
		},
		switchTo: function(appName) {
			let windowTitle = Win.appManager.registeredApps[appName].windowTitle;
			let processName = Win.appManager.registeredApps[appName].processName;
			if (windowTitle !== undefined) {
				Win.PowerShell('$myshell = New-Object -com "Wscript.Shell"; $myshell.AppActivate("' + windowTitle + '")', (stdout) => {
					if (stdout.includes('False')) {
						Win.log('Using process name as fallback. This may not be as accurate');
						nircmd('win activate process "' + processName + '"');
					}
				}, { noLog: true });
			} else {
				Win.error('Could not find Window title "' + windowTitle + '" or process of requested app "' + appName + '". The app may not be running.');
			}
		}
	},
	process: {
		getPid: function(processName, callback) {
			Win.PowerShell('get-process -ProcessName "' + replaceAll(processName, '.exe', '') + '" | Format-Table id', (stdout, stderr) => {
				stdout = replaceAll(stdout, 'Id', '');
				stdout = replaceAll(stdout, '--', '');
				stdout = replaceAll(stdout, '\r', '');
				stdout = stdout.trim();
				stdout = stdout.split('\n');
				stdout = stdout.filter(String);
				callback((!stdout.length ? false : stdout));
			}, { noLog: true, suppressErrors: true });
		},
		kill: function(nameOrPid) {
			if (nameOrPid != '' && nameOrPid != undefined && nameOrPid != null) Win.cmd('taskkill /F /IM "' + nameOrPid + '"');
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
			Win.PowerShell('get-process "' + replaceAll(processName, '.exe', '') + '" | select MainWindowTitle', function(stdout) {
				output = '' + stdout;
				output = replaceAll(output, 'MainWindowTitle', '');
				output = replaceAll(output, '---------------', '');
				output = output.trim();
				if (output == '') output = false;
				callback(output);
			}, { noLog: true, suppressErrors: true });
		},
		getPidByWindowTitle: function(windowTitle, callback) {
			Win.PowerShell('get-process | select ID, MainWindowTitle', stdout => {
				if (stdout.includes(windowTitle)) {

					stdout = replaceAll(stdout, ',', '');
					stdout = stdout.split('\r\n');
					for (let i in stdout) {
						if (stdout[i].includes(windowTitle)) {
							if (typeof callback == 'function') callback(stdout[i].replace(/[^0-9]/g, ""));
						}
					}
				} else {
					Win.error('Window title not found');
					if (typeof callback == "function") {

					}
				}
			}, { noLog: true, suppressErrors: true });
		},
		isRunning: function(processName, callback) {
			try {
				Win.PowerShell('get-process "' + processName + '" | select ProcessName', (stdout) => {
					if (stdout.includes(processName)) callback(true);
					else callback(false);
				});
			} catch (error) {
				Win.error(error);
				callback(false);
			}
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
				Win.PowerShell(['cd ' + Win.path`${__dirname}`, '\\nircmd.exe standby']);
			}, ((delay) ? delay : 0));
		},
		screenSaver: function(delay) {
			setTimeout(() => {
				Win.PowerShell(['cd ' + Win.path`${__dirname}`, '\\nircmd.exe screensaver']);
			}, ((delay) ? delay : 0));
		}
	},
	window: {
		minimize: function(processName) {
			if (processName !== undefined) {
				if (!processName.includes('.exe')) processName = processName + '.exe';
				Win.PowerShell(['cd ' + Win.path`${__dirname}`, '\\nircmd.exe win min process "' + processName + '"']);
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
				Win.PowerShell(['cd ' + Win.path`${__dirname}`, '\\nircmd.exe win setsize process "' + processName + '" x y ' + width + ' ' + height], { suppressErrors: true, noLog: true });
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
			Win.PowerShell([`$soundplayer = New-Object Media.SoundPlayer '` + path + `'`, ` $soundplayer.Play();`], null, { keepAlive: true });
		} else {
			Win.PowerShell(`Add-Type -AssemblyName presentationCore;
			$mediaPlayer = New-Object System.Windows.Media.MediaPlayer;
			$mediaPlayer.open("${path}");
			$mediaPlayer.Play()`, undefined, { keepAlive: true, noLog: true });
		}
	},
	stopAudio: function(path) {
		for (let i in powerShellSessions) {
			if (powerShellSessions[i].command[0].includes(replaceAll(path, '\\\\', '\\'))) {
				if (path.includes('.wav')) {
					powerShellSessions[i].newCommand(`$soundplayer.Stop()`);
					powerShellSessions[i].end();
				} else powerShellSessions[i].end();
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
			Add-Type -AssemblyName System.Windows.Forms
			$openFileDialog = New-Object System.Windows.Forms.OpenFileDialog
			$openFileDialog.Title = $WindowTitle
			if (![string]::IsNullOrWhiteSpace($InitialDirectory)) { $openFileDialog.InitialDirectory = $InitialDirectory }
			$openFileDialog.Filter = $Filter
			if ($AllowMultiSelect) { $openFileDialog.MultiSelect = $true }
			$openFileDialog.ShowHelp = $true	# Without this line the ShowDialog() function may hang depending on system configuration and running from console vs. ISE.
			$openFileDialog.ShowDialog() > $null
			if ($AllowMultiSelect) { return $openFileDialog.Filenames } else { return $openFileDialog.Filename }
		}`,
			`
		$filePath = Read-OpenFileDialog -WindowTitle "${(windowTitle ? windowTitle : `Select a File`)}" -InitialDirectory '${(initialDirectory ? replaceAll(initialDirectory, '\\\\', '\\') : `C:\\`)}' ${(filter && filter.filtertext && filter.filterby) ? `-Filter "${filter.filtertext} (${filter.filterby})|${filter.filterby}"` : ''} ${(allowMultiSelect ? `-AllowMultiSelect` : '')}; if (![string]::IsNullOrEmpty($filePath)) { Write-Host "$filePath" } else { "No file was selected" }
		`], result => {
				if (typeof callback == 'function') callback(result[0].includes('No file was selected') ? undefined : result[0]);
			}, { noLog: true });
	},
	toggleMediaPlayback: function() {
		Win.PowerShell(['cd ' + Win.path`${__dirname}`, '\\nircmd.exe sendkeypress 0xB3'])
	}
}

module.exports = Win;