# Changelog
I only started keeping a changelog for Windows Interact as of 1.1.7, but if you really want to see all the changes across all of the released versions, you can compare different versions of README.md in Github.

## 1.1.8
---
New in this version: 
 - `Win.appManager()` now has group app management
    - Assign apps to a group with `Win.appManager.register.group()`
    - Give all apps in a group the same `onLaunch` or `onKill`
    - Launch or kill all of the apps in a group at once.
 - `Win.PowerShell()`
   - A shiny new, super advanced, [mega futuristic session manager](https://github.com/Arlodotexe/windows-interact#winpowershell)!
        - `Win.PowerShell.addCommand()` to issue a new command
        - `Win.PowerShell.end()` to end a session
        - New options for `Win.PowerShell()`'s `options` parameter: 
        - `keepAlive` - Do not end the child process when the command(s) are completed
        - `ID` - Assign an identity to this PowerShell session in order to issue a new command or end it at a later time.
    - `Win.PowerShell()` can now accept an array of commands, and automatically collects and seperates the output
 - `Win.notify()` was broken on Windows 10 insider build 17746 and beyond, so I rewrote it from the ground up just for Windows 10 (and kept the old functionality for < 10). You can now use images or animated GIFs in notifications (and it's really freaking cool)
 - Added `Win.process.getPidByWindowTitle()`
 - `Win.log()` will not act more like `console.log()`. Any string that is passed as a parameter at any position will be printed back.
 - More options for Verbosity in `Win.set.preferences()`

 What's changed: 
 - Tons of bug fixes. Everywhere. This is the most changes in one version bump I've ever released, with 60+ git commits and hundreds if not 1 or 2 _thousand_ line changes
 - The appManager has been refactored to allow registering an app with any name, instead of the executable name
 - Fixed a lot of commands that would fail if your directory had a space in it
 - Adjusted `Win.process.kill()` to allow killing by PID and fixed it so it doesn't show a large red error message when the app isn't running
 - Removed Win.authCode from the documentation. This old code has nothing to do with interacting with windows and will be removed in the future
 
 Known issues: 
 - `Win.PowerShell()`:
   - Using `Start-Sleep` with any value greater than 800ms will cause some very odd issues with the internals of `Win.PowerShell()`. This is because 800ms is the extra time that each command is manually seperated to better discern output. This will be fixed in the future, but for now, avoid using `Start-Sleep` if possible


## 1.1.7
---
New in this version:
 - Added support for the native Windows File Picker
 - Added method for playing/stopping audio files
 - Added Win.prompt as a replacement for the browser's `prompt()`
 - An upgrade for managing and getting info about Audio Devices:
    - Retrieve information about audio devices 
    - Check/Set volume levels
    - Check/Set mute status
    - Check/Set default device
    - All of the above are available for input AND output devices!

 What's changed: 
 - Dependency on robot.js has been removed. Huzzah!
 - Removed `Win.Cortana()`. This hasn't been working on slower machines (my bad) and would require a massive amount of work to do properly. Likely to return in a future update.
 - `Win.pauseMedia()` is now `Win.toggleMediaPlayback()`
 - Complete rewrite of Win.PowerShell. There was a lot of issue with the previous implementation when it came to string parsing. Not only is it fixed now, but you can also run multiple commands in the same powershell process before closing it by passing in an array.
 - Removed `httpUrls` in preferences. I realized that I reinvented variables. Oops.
