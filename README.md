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
   STLINK    PINHEADER
    SWCLK -> MCU_TMS
    SWDIO -> MCU_SWO
      GND -> GND
   <img width="597" height="485" alt="image" src="https://github.com/user-attachments/assets/265c2b61-5c37-4d6c-83b6-2deafb9ab55f" />


6) ensure the jumpers are set so the external STLINK gets connected to the STLINK you're trying to program. From Krill's V2 and onwards, this should be default
   JUMPER    STATE
   J1101     OFF
   J1102     OFF
   J1103     OFF
   J1104     OFF
   J1105     OFF
   J1106     ON
   J1107     OFF
   J1108     ON

8) provide power to the board, either using the 5V_RAW pin on the programming header

9) connect to the external STLINK, wipe the chip, and flash ```Unprotected-2-1-Bootloader.bin```. make sure to check "verify programming", and make sure it starts at ```0x08000000```.

10) disconnect the external STLINK and the microUSB (IMPORTANT, reuneration is not like fully programmed in yet so this is vital and i think it needs a reset anyways lol)

11) open the **LEGACY PROGRAMMER**. this bypasses some DRM bullshit i don't really understand but it worked for me lol

12) connect the USB, wait for the "usb device connected" chime. if you opened device manager, under ```Universal Serial Bus devices``` it should have "STM32 STLink"

13) hit the ```device connect``` button. it should, uh, wokr, and a dropdown should appear on the right side. select the one that says STM32+VCP+MS or something, the one that has two +'s. then hit ```yes```

14) wait for it to finish, then close the legacy programmer. your shit is now flashed with an older version of the real hardware; newer than the ```Unprotected-2-1-Bootloader.bin```, but still outdated

15) now open the **MOST RECENT PROGRAMMER**. same story, disconnect and reconnect the USB, hit device connect. this time it should just have a ```Yes >>>``` thing, hit that and wait for it to be done

16) swap the jumpers from the STLINK programming configuration to the main MCU programming configuration

17) congrats you now have a stlink v2-1. ensure that everything worked by disconnecting and reconnecting the USB, opening STM32CubeProg, and ensuring that it shows up, you can connect, and you can read the memory of the main MCU. also ensure that in device manager, you see a ```STM32 STLink``` under ```Universal Serial Bus Devices``` and a  ```STMicroelectronics STLink Virtual COM Port (COMX)```. Finally, ensure that a drive named ```UNDEFINED``` pops up, only containing a file called ```DETAILS.TXT```
      - If there is a ```FAIL.TXT```, you have fucked up. check that your jumpers are right
