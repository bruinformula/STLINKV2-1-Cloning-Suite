STLink firmware upgrade applications

1. In folder Windows:

   Contains the application in its "historical" form: executable dedicated to Windows + dll.
   With all most recent firmwares for ST-Link/V1 boards, ST-Link/V2 boards, ST-Link/V2-1 boards,
   STLINK-V3 boards and STLINK-V3PWR.

2. In folder AllPlatforms:

   Contains a GUI based on Java, with native ST-Link libraries for running on Windows 32 bits,
   Windows 64bits, Linux 32bits, Linux 64bits and MacOS 64bits.
   
   The application requires the Java Runtime Environment 7u51 (or more recent) being installed.
   In platforms without .jar file extension association, the application can be launch by the command
   "java -jar STLinkUpgrade.jar".

   On Linux, the application relies on libusb-1.0, which must be installed separately. For
   instance on Ubuntu, through the command "sudo apt-get install libusb-1.0".

   On Linux, users must be granted with rights for accessing the ST-Link USB devices. To do
   that, it might be necessary to add rules into /etc/udev/rules.d. This can be achieved by
   running one of the package provided into the subdirectory StlinkRulesFilesForLinux.

3. In folder MacOS:

   Contains the Java application mentionned above, in a MacOS application format, digitally signed to avoid
   security warnings which could appear when launching directly the .jar on recent OSX versions. It also
   requires the Java Runtime Environment to be previously installed.