# STLINKV2-1-Cloning-Suite
All the software needed to clone STLINK V2-1s
LAST UPDATED 3/9/26; FOR KRILL V1

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

4) CUT THE JUMPERS J1101 J1102 J1103 J1104, then connect the actual STLINK to the programming header via SWD
```
   STLINK    PINHEADER
    SWCLK -> MCU_TMS
    SWDIO -> MCU_SWO
      GND -> GND
```
   <img width="597" height="485" alt="image" src="https://github.com/user-attachments/assets/265c2b61-5c37-4d6c-83b6-2deafb9ab55f" />


6) ensure the jumpers are set so the external STLINK gets connected to the STLINK you're trying to program. From Krill's V2 and onwards, this should be default
```
     Krill V1
   JUMPER    STATE
   J1101     OFF
   J1102     OFF
   J1103     OFF
   J1104     OFF
   J1105     OFF
   J1106     ON
   J1107     OFF
   J1108     ON 
```
8) provide power to the board, either using the 5V_RAW pin on the programming header

9) connect to the external STLINK, wipe the chip, and flash ```Unprotected-2-1-Bootloader.bin```. make sure to check "verify programming", and make sure it starts at ```0x08000000```.

10) disconnect the external STLINK and the microUSB (IMPORTANT, reuneration is not like fully programmed in yet so this is vital and i think it needs a reset anyways lol)

11) open the **LEGACY PROGRAMMER**. this bypasses some DRM bullshit i don't really understand but it worked for me lol

12) Another improtant step: MAKE SURE that the pullup is shorted to 3v3, no renumeration. the firmware in that unprotected bootloader binary does not support software-controlled renumeration yet, and the computer expects a 1.5k pullup to actually connect. For Krill V1, you will have to physically solder the resistor to 3v3, but for v2 onwards, you should be able to just pop a jumper (TBD)

13) connect the USB, wait for the "usb device connected" chime. if you opened device manager, under ```Universal Serial Bus devices``` it should have "STM32 STLink"
 should look like this after u hit the device connect button
 <img width="1696" height="622" alt="image" src="https://github.com/user-attachments/assets/0810c827-f79d-47af-89f5-437438272365" />

14) hit the ```device connect``` button. it should, uh, wokr, and a dropdown should appear on the right side. select the one that says STM32+VCP+MS or something, the one that has two +'s. then hit ```yes```
<img width="809" height="438" alt="image" src="https://github.com/user-attachments/assets/01aec290-ca46-403f-b9f2-55188aba3750" />


15) wait for it to finish, then close the legacy programmer. your shit is now flashed with an older version of the real hardware; newer than the ```Unprotected-2-1-Bootloader.bin```, but still outdated

16) now open the **MOST RECENT PROGRAMMER**. same story, disconnect and reconnect the USB, hit device connect. It'll like spaz out for a sec and complain about making sure your hardware is recent enough, but just hit OK and press "Device Connect" again. This time it should just have a ```Yes >>>``` thing, hit that and wait for it to be done

Error message:
<img width="819" height="463" alt="image" src="https://github.com/user-attachments/assets/3dfe70d3-a5ac-49fc-8e19-f0f76291493d" />

Should look like this:
<img width="817" height="455" alt="image" src="https://github.com/user-attachments/assets/d0713d59-59f5-47fa-befa-25e35e4ef773" />

After hitting ```Yes >>>```
<img width="820" height="463" alt="image" src="https://github.com/user-attachments/assets/ab750601-53c6-4325-9c23-9aa5be9cd9de" />


17) swap the jumpers from the STLINK programming configuration to the main MCU programming configuration
```
      Krill V1
   JUMPER    STATE
   J1101     ON
   J1102     ON
   J1103     ON
   J1104     ON
   J1105     OFF
   J1106     OFF
   J1107     OFF
   J1108     OFF
```

18) congrats you now have a stlink v2-1. ensure that everything worked by disconnecting and reconnecting the USB, opening STM32CubeProg, and ensuring that it shows up, you can connect, and you can read the memory of the main MCU. also ensure that in device manager, you see a ```STM32 STLink``` under ```Universal Serial Bus Devices``` and a  ```STMicroelectronics STLink Virtual COM Port (COMX)```. Finally, ensure that a drive named ```UNDEFINED``` pops up, only containing a file called ```DETAILS.TXT```
      - If there is a ```FAIL.TXT```, you have fucked up. check that your jumpers are right


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
