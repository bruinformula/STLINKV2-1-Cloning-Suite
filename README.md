# STLINKV2-1-Cloning-Suite
All the software needed to clone STLINK V2-1s
LAST UPDATED 4/24/26; FOR KRILL V2

## Electron app

There is now an Electron wrapper in [electron-app](/Users/guestaccount/Desktop/STLINKV2-1-Cloning-Suite/electron-app) that turns the repo into a guided one-button flow.

What it does:
1) detects the bundled bootloader and both ST update tools
2) detects Java and STM32CubeProgrammer CLI, with manual path overrides if auto-detect misses them
3) mass-erases and flashes [Unprotected-2-1-Bootloader.bin](/Users/guestaccount/Desktop/STLINKV2-1-Cloning-Suite/Unprotected-2-1-Bootloader.bin) through STM32CubeProgrammer CLI
4) launches the legacy updater, then the most recent updater
5) attempts best-effort macOS UI automation for those vendor GUIs when enabled
6) applies the final `nSWBOOT0=0` option-byte change through STM32CubeProgrammer CLI

What it does not do:
1) it does not reimplement ST's updater protocol from scratch yet
2) it still depends on STM32CubeProgrammer CLI being installed locally
3) the legacy and recent ST firmware updaters are still the vendor JARs, because they appear to be GUI-only
4) if the vendor UI changes, the macOS auto-click logic may miss and you will need to finish that stage manually

Run it like this after installing Node.js:

```bash
cd electron-app
npm install
npm start
```

Recommended use:
1) use the app's `Refresh Preflight` button first and confirm it finds Java and `STM32_Programmer_CLI`
2) leave the override fields empty unless auto-detect is wrong
3) press `Run Full Clone Flow`
4) follow the hardware prompts when the app asks you to switch between pogo/SWD and USB
5) if an ST updater window stalls, use the instructions shown by the app and then close the updater window to let the flow continue

other downloads needed:
1) [STM32CubeProgrammer]([url](https://www.st.com/en/development-tools/stm32cubeprog.html))

Necessary hardware:
1) some sort of STLINK V2-1 hardware. Krills, Minnows, and potentially future BFR microcontrollers will have this.
2) jumper wires
3) microUSB cable
4) some sort of STLINK

Steps:
1) clone this repo

2) open STM32CubeProg

3) install the drivers by opening the EXE file for your CPU in the ```stsw-LINK009 - Drivers``` folder

4) Make sure the STLINK jumpers are shorted. For V2 they aren't presoldered because of cost-cutting, in future versions they might be or they'll be solder jumpers.

<img width="3024" height="4032" alt="IMG_4781" src="https://github.com/user-attachments/assets/f30033bc-7a41-454d-9b42-0de429ceeffb" />

5) Attach the programming POGO connector

<img width="3024" height="4032" alt="IMG_4781" src="https://github.com/user-attachments/assets/f30033bc-7a41-454d-9b42-0de429ceeffb" />

6) connect to the external STLINK, wipe the chip, and flash ```Unprotected-2-1-Bootloader.bin```. make sure to check "verify programming", and make sure it starts at ```0x08000000```.

7) disconnect the POGO header

8) open the **LEGACY PROGRAMMER**. this bypasses some DRM bullshit i don't really understand but it worked for me lol


9) connect the USB, wait for the "usb device connected" chime. if you opened device manager, under ```Universal Serial Bus devices``` it should have "STM32 STLink"
 should look like this after u hit the device connect button
 <img width="1696" height="622" alt="image" src="https://github.com/user-attachments/assets/0810c827-f79d-47af-89f5-437438272365" />

10) hit the ```device connect``` button. it should, uh, wokr, and a dropdown should appear on the right side. select the one that says STM32+VCP+MS or something, the one that has two +'s. then hit ```yes```
<img width="809" height="438" alt="image" src="https://github.com/user-attachments/assets/01aec290-ca46-403f-b9f2-55188aba3750" />


11) wait for it to finish, then close the legacy programmer. your shit is now flashed with an older version of the real hardware; newer than the ```Unprotected-2-1-Bootloader.bin```, but still outdated

12) now open the **MOST RECENT PROGRAMMER**. same story, disconnect and reconnect the USB, hit device connect. It'll like spaz out for a sec and maybe complain about making sure your hardware is recent enough or an 0x1 error or something, but just hit OK and press "Device Connect" again. This time it should just have a ```Yes >>>``` thing, hit that and wait for it to be done

Error message:
<img width="819" height="463" alt="image" src="https://github.com/user-attachments/assets/3dfe70d3-a5ac-49fc-8e19-f0f76291493d" />

Should look like this:
<img width="817" height="455" alt="image" src="https://github.com/user-attachments/assets/d0713d59-59f5-47fa-befa-25e35e4ef773" />

After hitting ```Yes >>>```
<img width="820" height="463" alt="image" src="https://github.com/user-attachments/assets/ab750601-53c6-4325-9c23-9aa5be9cd9de" />

13) congrats you now have a stlink v2-1. ensure that everything worked by disconnecting and reconnecting the USB, opening STM32CubeProg, and ensuring that it shows up, you can connect, and you can read the memory of the main MCU. also ensure that in device manager, you see a ```STM32 STLink``` under ```Universal Serial Bus Devices``` and a  ```STMicroelectronics STLink Virtual COM Port (COMX)```. Finally, ensure that a drive named ```UNDEFINED``` pops up, only containing a file called ```DETAILS.TXT```
      - If there is a ```FAIL.TXT```, you have fucked up. check that your jumpers are right

14) CRITICAL STEP for reasons i forgot: MAKE SURE you then use the USB to connect to STM32cubeprog, then go to Option Bytes > User Configuration > nSWBOOT0 and uncheck it. Forgot exactly why, but it broke HAL_Delay() among other things, i think the clock might have just not ticked.
<img width="2408" height="1396" alt="image" src="https://github.com/user-attachments/assets/c0033b48-30f6-4def-82aa-ea02cbb18885" />



📝 Addendum: Troubleshooting macOS "UnsatisfiedLinkError"
If you are running the Legacy Programmer on a Mac and encounter a java.lang.UnsatisfiedLinkError: Can't load library... libSTLinkUSBDriver.dylib, follow these steps to fix the broken library links.

The Problem

The legacy libSTLinkUSBDriver.dylib was compiled with a hardcoded dependency on libusb located in the /opt/local/ directory (standard for MacPorts). Most modern Mac users either have no libusb or have it installed via Homebrew in /usr/local/, causing the Java app to fail when it can't find its "friend" library.

The Fix

Install Homebrew & libusb If you don't have Homebrew, install it, then run:

Bash
brew install libusb
Create the Library Bridge (Symlink) You must trick the driver into finding the Homebrew version of the library where it expects the MacPorts version to be. Run these commands in your terminal:

Bash
# Create the directory the driver is looking for
sudo mkdir -p /opt/local/lib

# Create a symbolic link to the Homebrew version
sudo ln -s /usr/local/lib/libusb-1.0.dylib /opt/local/lib/libusb-1.0.0.dylib
Strip macOS Quarantine Flags macOS often blocks these older .dylib files from executing. Run this on your cloning suite folder:

Bash
sudo xattr -rd com.apple.quarantine "/path/to/STLINKV2-1-Cloning-Suite/"
Launch with Explicit Library Path When running the JAR, tell Java exactly where to find the native folder:

Bash
java -Djava.library.path="native/mac_x64" -jar STLinkUpgrade.jar
Troubleshooting Architecture

Intel Macs: The steps above should resolve all issues.

Apple Silicon (M1/M2/M3): You may need to prefix the java command with arch -x86_64 to run the tool via Rosetta 2, as the legacy driver is likely x86_64 only.
