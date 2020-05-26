//==============================================================================
// wgssStuSdk.js
// Copyright (c) 2015-2017 Wacom Co.,Ltd.
//
// 15/10/2015  FRE Created
//==============================================================================
//NOTE: Requires q lib https://github.com/kriskowal/q/raw/v1/q.js

// global namespace
var WacomGSS = WacomGSS || {};

// UTF-8 helper functions
// https://developer.mozilla.org/en-US/docs/Web/API/WindowBase64/btoa
// Note: btoa and atob are not supported on IE 9 or lower
function utf8_to_b64(str) {
    return window.btoa(unescape(encodeURIComponent(str)));
}

function b64_to_utf8(str) {
    return decodeURIComponent(escape(window.atob(str)));
}

WacomGSS.STUConstructor = (function() {

  var websocket;

  var MaxChunkSize = 65535; // size of chunks to split the message into
  
  var ticketCount = 0;
  var streamCount = 0;
  var table = {};
  var stream = {};
  function checkExists(obj) {
    return 'undefined' !== typeof obj;
  }
  
  function getTicket() {
     return ticketCount++;
   }
   
  function getStream() {
     return streamCount++;
   }

  // Constructor
  function STU(port) {
    var defPort = 9000;
    var self = this;
    if(!checkExists(port))
    {
      port = defPort;
    }

    this.onDCAtimeout = null;

    websocket = new WebSocket("wss://localhost:" + port.toString() + "/ws");
    
    websocket.onopen = function() { 
      console.log("connected");
    }
    websocket.onmessage = receive;
    websocket.onclose = function() {
      console.log("disconnected");
      if (typeof self.onDCAtimeout === "function") {
        self.onDCAtimeout();
      }
    }

  }

  STU.prototype.Reinitialize = function() {
    WacomGSS.STU = new WacomGSS.STUConstructor();
  }
  
  STU.prototype.isServiceReady = function() {
    return 1 == websocket.readyState;
  }

  STU.prototype.isDCAReady = function() {
    var deferred = Q.defer();
    if(!WacomGSS.STU.isServiceReady()) {
      deferred.resolve(false);
    }
    else {
      setTimeout(function () {
                   if(deferred.promise.isPending()) {
                     if(WacomGSS.STU.isServiceReady()) {
                       WacomGSS.STU.close();
                     }
                     deferred.resolve(false);
                   }
                 }, 1000);
      WacomGSS.STU.getUsbDevices()
      .then( function(message) {
        if(deferred.promise.isPending()) {
          deferred.resolve(true);
        }
      })
      .fail( function(message) {
        if(deferred.promise.isPending()) {
          deferred.resolve(true);
        }
      })
    }
    return deferred.promise;
  }
  
  STU.prototype.close = function() {
    websocket.close();
  }

  function receive(message) {
    if (typeof message.data !== 'undefined' && message.data != "") {
      //console.log("receive: " + message.data);
      var arg = JSON.parse(message.data);
      if (checkExists(arg.ticket) && checkExists(table[arg.ticket])) {
        if (checkExists(arg.success) && true == arg.success && checkExists(arg.data)) {
          table[arg.ticket].resolve(arg.data);
        }
        else {
          table[arg.ticket].reject(new Error(checkExists(arg.error) ? arg.error : ""));
        }
        delete table[arg.ticket];
      }
      else if (checkExists(arg.stream) && checkExists(stream[arg.stream]) && checkExists(arg.data)) {
        stream[arg.stream].stream(arg.data);
      }
      else {
        throw new Error("websocket invalid message: " + message.data)
      }
    }
    else {
      console.log("Unexpected message type " + typeof message + " = " + JSON.stringify(message));
    }
  }
  
  // sends unlimited sized message strings
  function wsSend(myString) {
    //console.log("Sending " + myString);
    var length = myString.length;
    var pos = 0;

    while (pos < length)
    {
      var header = (pos + MaxChunkSize < length)? "0" : "1";
      var chunk = myString.substr(pos, MaxChunkSize);

      websocket.send(header + chunk);
      pos += MaxChunkSize;
    }
  }
  // USB device Vendor ID for Wacom.
  STU.prototype.VendorId = 
  {
    VendorId_Wacom : 0x056a
  };
  // brief USB device Product IDs for STU tablets.
  STU.prototype.ProductId =
  {
    ProductId_500  : 0x00a1,  // STU-500 
    ProductId_300  : 0x00a2,  // STU-300 
    ProductId_520A : 0x00a3,  // STU-520
    ProductId_430  : 0x00a4,  // STU-430 
    ProductId_530  : 0x00a5,  // STU-530   
    ProductId_430V : 0x00a6,  // STU-430V
    ProductId_540  : 0x00a8,  // STU-540
    ProductId_541  : 0x00a9   // STU-541
};
  STU.prototype.ProductId_min = 0x00a1;
  STU.prototype.ProductId_max = 0x00af 

  STU.prototype.send = function(object) {
    var deferred = Q.defer();
    try {
      var ticket = getTicket();
      object["ticket"] = ticket;
      var str = JSON.stringify(object);
      wsSend(str);
      table[ticket] = deferred;
      //console.log("send: " + JSON.stringify(object));
    } catch (err) {
      deferred.reject(err);
    }
    return deferred.promise;
  }
  
  STU.prototype.sendNoReturn = function(object) {
    var str = JSON.stringify(object);
    wsSend(str);
    //console.log("send: " + str);
  }
  
  STU.prototype.setStream = function(functor) {
    var streamId = getStream();
    stream[streamId] = functor;
    return streamId;
  }
  
  STU.prototype.removeStream = function(streamId) {
    delete stream[streamId];
  }
  
  STU.prototype.getUsbDevices = function() {
    return WacomGSS.STU.send
           ({
             "scope": "WacomGSS.STU.GetUsbDevices", 
             "function": "getUsbDevices"
           });
  }
  
  STU.prototype.getTlsDevices = function () {
    return WacomGSS.STU.send
           ({
             "scope": "WacomGSS.STU.GetTlsDevices",
             "function": "getTlsDevices"
           });
  }

  STU.prototype.isSupportedUsbDevice = function (idVendor, idProduct) {
    return WacomGSS.STU.send
           ({
             "scope": "WacomGSS.STU.GetUsbDevices", 
             "function": "isSupportedUsbDevice", 
             "idVendor": idVendor, 
             "idProduct": idProduct
           });
  }
  // usbDevice type is UsbDevice
  STU.prototype.getStringUsbDevice = function(usbDevice) {
    function get4DigitsHex(number) {
    return ("0000" + number.toString(16)).substr(-4);
 }
 
 return get4DigitsHex(usbDevice.idVendor)  + ":" +
        get4DigitsHex(usbDevice.idProduct) + ":" +
        get4DigitsHex(usbDevice.bcdDevice);
  }
  
  STU.prototype.SerialPort =
  {
    Type :  
         {
             Unknown  : 0,
             Physical : 1,
             Virtual  : 2,
             Remote   : 3
         }
  }
  
  STU.prototype.getSerialPorts = function() {
    return WacomGSS.STU.send
           ({
             "scope": "WacomGSS.STU.GetSerialPorts", 
             "function": "getSerialPorts"
           });
  }
  
  STU.prototype.UsbInterface = (function() {
    
    var scope = "WacomGSS.STU.UsbInterface";
    var id = "";
    // Constructor
    function UsbInterface() {
    }
    
    UsbInterface.prototype.Constructor = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "function": "Constructor"
             })
             .then( function(message) {
               id = message.id;
               return message;
             });
    }
    
    UsbInterface.prototype.connect = function(usbDevice, exclusiveLock) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "connect", 
               "usbDevice": usbDevice, 
               "exclusiveLock": exclusiveLock
             });
    }
    
    UsbInterface.prototype.toJSON = function() {
      return {"id": id, "scope": scope};
    }
    
    UsbInterface.prototype.disconnect = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "disconnect"
             });
    }
    
    UsbInterface.prototype.isConnected = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "isConnected"
             });
    }
    
    UsbInterface.prototype.queueNotifyAll = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "queueNotifyAll"
             });
    }
    // predicate type is Boolean
    UsbInterface.prototype.queueSetPredicateAll = function(predicate) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "queueSetPredicateAll",
               "predicate": predicate
             });
    }
    // length type is an integer
    UsbInterface.prototype.get = function(length) {
      return WacomGSS.STU.send // returns a Base64-encoded string
             ({
               "scope": scope, 
               "id": id, 
               "function": "get_", // the '_' is deliberate
               "length": length
             });
    }
    // base64Data is a base64-encoded image string, or a DataStore reference to it
    UsbInterface.prototype.set = function(base64Data) {
      return WacomGSS.STU.send 
             ({
               "scope": scope, 
               "id": id, 
               "function": "set", 
               "base64Data": base64Data
             });
    }
    
    UsbInterface.prototype.supportsWrite = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "supportsWrite"
             });
    }
    // base64Data type is a base64-encoded image string, or a DataStore reference to it
    UsbInterface.prototype.write = function(base64Data) {
      return WacomGSS.STU.send 
             ({
               "scope": scope, 
               "id": id, 
               "function": "write", 
               "base64Data": base64Data
             });
    }
 
    UsbInterface.prototype.getReportCountLengths = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getReportCountLengths"
             });
    }
    
    UsbInterface.prototype.getProductId = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getProductId"
             });
    }
    
    return UsbInterface;
  })();
  
  STU.prototype.Protocol = (function() {
  
    var scope = "WacomGSS.STU.Protocol";
    var id = "";
    var intf = {};
    
    // Constructor
    function Protocol() {
    }
    
    Protocol.prototype.PenDataOptionMode = 
    {
      PenDataOptionMode_None              : 0x00, // Report PenData/PenDataEncrypted.
      PenDataOptionMode_TimeCount         : 0x01, // Report PenDataOption/PenDataEncryptedOption with timeCount field set. (520 only)
      PenDataOptionMode_SequenceNumber    : 0x02, // Report PenDataOption/PenDataEncryptedOption with sequenceNumber field set.
      PenDataOptionMode_TimeCountSequence : 0x03  // Report PenDataTimeCountSequence/PenDataTimeCountSequenceEncrypted with sequenceNumber field set. (430/530 only)
    }
    
    Protocol.prototype.InkingMode = 
    {
      InkingMode_Off : 0x00,
      InkingMode_On : 0x01
    }
    
    Protocol.prototype.ReportId = 
    {
      ReportId_PenData                           : 0x01, // <b>Mode:</b> in         <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_Status                            : 0x03, // <b>Mode:</b>    get     <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_Reset                             : 0x04, // <b>Mode:</b>        set <b>Compatibility:</b> 300 500 520A 430 530 540
      //ReportId_05                                : 0x05, //   <b>Mode:</b> -internal- <b>Compatibility:</b> 300fw2
      ReportId_HidInformation                    : 0x06, // <b>Mode:</b>    get     <b>Compatibility:</b>  -   -   -   430V -  540
      ReportId_Information                       : 0x08, // <b>Mode:</b>    get     <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_Capability                        : 0x09, // <b>Mode:</b>    get     <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_Uid                               : 0x0a, // <b>Mode:</b>    get/set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_Uid2                              : 0x0b, // <b>Mode:</b>    get     <b>Compatibility:</b>  -   -   -   430 530 540
      ReportId_DefaultMode                       : 0x0c, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -   430V    540
      ReportId_ReportRate                        : 0x0d, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -   430V    540
      ReportId_RenderingMode                     : 0x0e, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_Eserial                           : 0x0f, // <b>Mode:</b>    get     <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_PenDataEncrypted                  : 0x10, // <b>Mode:</b> in         <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_HostPublicKey                     : 0x13, // <b>Mode:</b>    get/set <b>Compatibility:</b> 300 500 520A  -   -   -
      ReportId_DevicePublicKey                   : 0x14, // <b>Mode:</b> in/get     <b>Compatibility:</b> 300 500 520A  -   -   -
      ReportId_StartCapture                      : 0x15, // <b>Mode:</b>        set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_EndCapture                        : 0x16, // <b>Mode:</b>        set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_DHprime                           : 0x1a, // <b>Mode:</b>    get/set <b>Compatibility:</b> 300 500 520A  -   -   -
      ReportId_DHbase                            : 0x1b, // <b>Mode:</b>    get/set <b>Compatibility:</b> 300 500 520A  -   -   -
      ReportId_ClearScreen                       : 0x20, // <b>Mode:</b>        set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_InkingMode                        : 0x21, // <b>Mode:</b>    get/set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_InkThreshold                      : 0x22, // <b>Mode:</b>    get/set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_ClearScreenArea                   : 0x23, // <b>Mode:</b>        set <b>Compatibility:</b>  -   -   -   430 530 540
      ReportId_StartImageDataArea                : 0x24, // <b>Mode:</b>        set <b>Compatibility:</b>  -   -   -   430 530 540
      ReportId_StartImageData                    : 0x25, // <b>Mode:</b>        set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_ImageDataBlock                    : 0x26, // <b>Mode:</b>        set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_EndImageData                      : 0x27, // <b>Mode:</b>        set <b>Compatibility:</b> 300 500 520A 430 530 540
      ReportId_HandwritingThicknessColor         : 0x28, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -  520A 430 530 540  *430:thickness only
      ReportId_BackgroundColor                   : 0x29, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -  520A  -  530 540
      ReportId_HandwritingDisplayArea            : 0x2a, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -  520A 430 530 540
      ReportId_BacklightBrightness               : 0x2b, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -  520A  -  530 540
      ReportId_ScreenContrast                    : 0x2c, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -  520A  -  530 540
      ReportId_HandwritingThicknessColor24       : 0x2d, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -   430 530 540  *430:thickness only
      ReportId_BackgroundColor24                 : 0x2e, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -    -  530 540
      ReportId_BootScreen                        : 0x2f, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -   430 530 540
      ReportId_PenDataOption                     : 0x30, // <b>Mode:</b> in         <b>Compatibility:</b>  -   *  520A  -   -   -   *500:fw2.03 only
      ReportId_PenDataEncryptedOption            : 0x31, // <b>Mode:</b> in         <b>Compatibility:</b>  -   *  520A  -   -   -   *500:fw2.03 only
      ReportId_PenDataOptionMode                 : 0x32, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   *  520A 430 530 540  *500:fw2.03 only
      ReportId_PenDataTimeCountSequenceEncrypted : 0x33, // <b>Mode:</b> in         <b>Compatibility:</b>  -   -   -   430 530 540
      ReportId_PenDataTimeCountSequence          : 0x34, // <b>Mode:</b> in         <b>Compatibility:</b>  -   -   -   430 530 540
      ReportId_EncryptionCommand                 : 0x40, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -   430 530 540
      ReportId_EncryptionStatus                  : 0x50, // <b>Mode:</b> in/get     <b>Compatibility:</b>  -   -   -   430 530 540
      //ReportId_60                                : 0x60, //   <b>Mode:</b> -internal- <b>Compatibility:</b>  -   -   -   430 530 540
      ReportId_GetReport                         : 0x80, // <b>Mode:</b>        set <b>Compatibility:</b> SERIAL ONLY
      ReportId_SetResult                         : 0x81, // <b>Mode:</b> in         <b>Compatibility:</b> SERIAL ONLY
      ReportId_PinPadData                        : 0x90, // <b>Mode:</b> in         <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_PinPadDataEncrypted               : 0x91, // <b>Mode:</b> in         <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_PinOperationMode                  : 0x92, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_OperationMode                     : 0x93, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_RomStartImageData                 : 0x94, // <b>Mode:</b>        set <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_RomImageOccupancy                 : 0x95, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_RomImageHash                      : 0x96, // <b>Mode:</b>    get/set <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_RomImageDelete                    : 0x97, // <b>Mode:</b>        set <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_CurrentImageArea                  : 0x98, // <b>Mode:</b>    get     <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_EventData                         : 0x99, // <b>Mode:</b> in         <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_EventDataEncrypted                : 0x9a, // <b>Mode:</b> in         <b>Compatibility:</b>  -   -   -    -   -  540
      ReportId_RomImageDisplay                   : 0x9b, // <b>Mode:</b>        set <b>Compatibility:</b>  -   -   -    -   -  540
      //,ReportId_a0                                : 0xa0, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_a2                                : 0xa2, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_a3                                : 0xa3, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_a5                                : 0xa5, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_a6                                : 0xa6, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_a7                                : 0xa7, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_a8                                : 0xa8, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_a9                                : 0xa9, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_aa                                : 0xaa, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_ab                                : 0xab, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_ac                                : 0xac, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_ad                                : 0xad, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_ae                                : 0xae, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_af                                : 0xaf, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_b0                                : 0xb0, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_b2                                : 0xb2, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_b3                                : 0xb3, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      //ReportId_b4                                : 0xb4, //   <b>Mode:</b> -internal- <b>Compatibility:</b>
      ReportId_ReportSizeCollection              : 0xff,  // <b>Mode:</b>    get     <b>Compatibility:</b>  -   -   -   430V -   -

      // SigCaptX specific
      Decrypt                       : 0x100,    // for backwards compatibility
      SigCaptX_Decrypt              : 0x100,
      SigCaptX_TabletDisconnected   : 0x101

    }
 
    Protocol.prototype.DefaultMode = 
    {
      DefaultMode_HID    : 0x1, // communications protocol will be STU/HID/USB
      DefaultMode_Serial : 0x2  // communications protocol will be STU/Serial/USB
    }
     
    Protocol.prototype.StatusCode = 
    {
      StatusCode_Ready          : 0x00, // Normal state; tablet is transferring pen coordinates. Ready to receive commands.
      StatusCode_Image          : 0x01, // %Tablet switches to this after ReportId_StartImageData.
      StatusCode_Capture        : 0x02, // %Tablet switches to this after ReportId_StartCapture; tablet is transferring encrypted pen coordinates. Ready to receive commands.
      StatusCode_Calculation    : 0x03, // %Tablet is calculating encryption keys.        
      StatusCode_Image_Boot     : 0x04, // %Tablet is displaying the boot image. The tablet will automatically change to Ready when finished.
      StatusCode_RomBusy        : 0x05, // %Tablet is accessing the ROM.
      StatusCode_SystemReset    : 0xff  // %Tablet is resetting. So, any function isn't available.
    }
 
    Protocol.prototype.ErrorCode = 
    {
      ErrorCode_None                        : 0x00,   // Operation completed successfully.  
      ErrorCode_WrongReportId               : 0x01,   // Wrong ReportId in received command. 
      ErrorCode_WrongState                  : 0x02,   // Command was received when the tablet was in the wrong state, it cannot be processed.
                
      ErrorCode_CRC                         : 0x03,   // CRC error was detected in packed received by the tablet (serial interface only). 
      ErrorCode_GraphicsWrongEncodingType   : 0x10,   // Wrong encoding type in report data. 
      ErrorCode_GraphicsImageTooLong        : 0x11,   // Trying to draw outside video memory.
      ErrorCode_GraphicsZlibError           : 0x12,   // An error was returned by the ZLIB inflate function.

      ErrorCode_GraphicsWrongParameters     : 0x15,   // Image area or handwriting display area is invalid.
     
      ErrorCode_PadNotExist                 : 0x20,   // The image for this pad setting does not exist, only used for PINpad and KEYpad mode.
      ErrorCode_RomSizeOverflow             : 0x33,   // The image size exceed the limitation
      ErrorCode_RomInvalidParameter         : 0x34,   // Parameter is not valid when using ROM image, such as wrong image number
      ErrorCode_RomErrorCRC                 : 0x35    // CRC error occurs when writing image to ROM

    //ErrorCode_GraphicsSprleImageOverflow  : 0x1E,   // undocumented
    //ErrorCode_GraphicsSprleBlockOverflow  : 0x1F,   // undocumented

    //ErrorCode_Crypt_errors                : 0x20,   // undocumented
    //ErrorCode_Crypt_dh_zero_input         : 0x21,   // undocumented
    //ErrorCode_Crypt_dh_test_failed        : 0x22,   // undocumented
    //ErrorCode_Crypt_dh_wrong_module       : 0x23,   // undocumented
    //ErrorCode_Crypt_dh_wrong_base         : 0x24,   // undocumented
    //ErrorCode_Crypt_dh_wrong_openkey      : 0x25,   // undocumented
    //ErrorCode_Crypt_dh_key_invalid        : 0x26,   // undocumented
    //ErrorCode_Crypt_engine_invalid        : 0x27,   // undocumented

    //ErrorCode_Internal                    :  0x80 ~ 0xff
    }
     
    Protocol.prototype.Rectangle =
    {
      upperLeftXpixel : 0,
      upperLeftYpixel : 0,
      lowerRightXpixel : 0,
      lowerRightYpixel : 0
    }
     
    Protocol.prototype.InkThreshold = 
    {
      onPressureMark : 0,
      offPressureMark : 0
    }

    Protocol.prototype.HandwritingThicknessColor =
    {
      penColor : 0,
      penThickness : 0
    }
     
    Protocol.prototype.HandwritingThicknessColor24 =
    {
      penColor : 0,
      penThickness : 0
    }
 
    Protocol.prototype.EncryptionCommandNumber = 
    {
      EncryptionCommandNumber_SetEncryptionType    : 0x01,
      EncryptionCommandNumber_SetParameterBlock    : 0x02,
      EncryptionCommandNumber_GetStatusBlock       : 0x03,
      EncryptionCommandNumber_GetParameterBlock    : 0x04,
      EncryptionCommandNumber_GenerateSymmetricKey : 0x05,
    //EncryptionCommandNumber_Reserved_06          : 0x06,
    //EncryptionCommandNumber_Reserved_07          : 0x07,
    //EncryptionCommandNumber_Reserved_08          : 0x08,
    //EncryptionCommandNumber_Reserved_09          : 0x09
    }
     
    Protocol.prototype.EncodingMode = 
    {
      EncodingMode_1bit       : 0x00, // uncompressed monochrome
      EncodingMode_1bit_Zlib  : 0x01, // Zlib-compressed monochrome
      EncodingMode_16bit      : 0x02, // uncompressed color
      EncodingMode_24bit      : 0x04, // uncompressed color (530 only)
      EncodingMode_1bit_Bulk  : 0x10, // data will be sent using Interface::write() instead of Interface::set().
      EncodingMode_16bit_Bulk : 0x12, // data will be sent using Interface::write() instead of Interface::set().
      EncodingMode_24bit_Bulk : 0x14  // data will be sent using Interface::write() instead of Interface::set() (530 only).
    }
     
    Protocol.prototype.EndImageDataFlag = 
    {
      EndImageDataFlag_Commit  : 0x00,
      EndImageDataFlag_Abandon : 0x01
    }
     
    Protocol.prototype.ResetFlag = 
    {
      ResetFlag_Software : 0x00, // Perform a soft reset.
      ResetFlag_Hardware : 0x01  // Perform a hard reset.
    }
     
    Protocol.prototype.EncodingFlag = 
    {
      EncodingFlag_Zlib  : 0x01, // set if ZLIB is supported for color compression (not bulk).
      EncodingFlag_1bit  : 0x02,
      EncodingFlag_16bit : 0x04,
      EncodingFlag_24bit : 0x08,
    }
     
    Protocol.prototype.StatusCodeRSA = 
    {
      StatusCodeRSA_Ready       : 0x00,
      StatusCodeRSA_Calculating : 0xFA,
      StatusCodeRSA_Even        : 0xFB,
      StatusCodeRSA_Long        : 0xFC,
      StatusCodeRSA_Short       : 0xFD,
      StatusCodeRSA_Invalid     : 0xFE,
      StatusCodeRSA_NotReady    : 0xFF
    }
         
    Protocol.prototype.ErrorCodeRSA = 
    {
      ErrorCodeRSA_None                    :  0x00,
      ErrorCodeRSA_BadParameter            :  0x01,
      ErrorCodeRSA_ParameterTooLong        :  0x02,
      ErrorCodeRSA_PublicKeyNotReady       :  0x03,
      ErrorCodeRSA_PublicExponentNotReady  :  0x04,
      ErrorCodeRSA_SpecifiedKeyInUse       :  0x05,
      ErrorCodeRSA_SpecifiedKeyNotInUse    :  0x06,
      ErrorCodeRSA_BadCommandCode          :  0x07,
      ErrorCodeRSA_CommandPending          :  0x08,
      ErrorCodeRSA_SpecifiedKeyExists      :  0x09,
      ErrorCodeRSA_SpecifiedKeyNotExist    :  0x0A,
      ErrorCodeRSA_NotInitialized          :  0x0B
    }
     
    Protocol.prototype.SymmetricKeyType = 
    {
      SymmetricKeyType_AES128  :  0,
      SymmetricKeyType_AES192  :  1,
      SymmetricKeyType_AES256  :  2
    }
 
    Protocol.prototype.AsymmetricKeyType  =  
    {
      AsymmetricKeyType_RSA1024  :  0,
      AsymmetricKeyType_RSA1536  :  1,
      AsymmetricKeyType_RSA2048  :  2
    }
 
    Protocol.prototype.AsymmetricPaddingType  =  
    {
      AsymmetricPaddingType_None   :  0,
      AsymmetricPaddingType_PKCS1  :  1,
      AsymmetricPaddingType_OAEP   :  2
    }
 
    Protocol.prototype.AsymmetricPaddingType  =  
    {
      EncryptionCommandParameterBlockIndex_RSAe : 0,
      EncryptionCommandParameterBlockIndex_RSAn : 1,
      EncryptionCommandParameterBlockIndex_RSAc : 2,
      EncryptionCommandParameterBlockIndex_RSAm : 3
    }
     
    Protocol.prototype.RomImageDeleteMode =
    {
      RomImageDeleteMode_All                : 0x00,
      RomImageDeleteMode_PinPad_All         : 0x01,
      RomImageDeleteMode_SlideShow_All      : 0x02,
      RomImageDeleteMode_KeyPad_All         : 0x03,
      RomImageDeleteMode_Signature_All      : 0x04,
      RomImageDeleteMode_MessageBox_All     : 0x05,
      RomImageDeleteMode_PinPad_Number      : 0x06,
      RomImageDeleteMode_SlideShow_Number   : 0x07,
      RomImageDeleteMode_KeyPad_Number      : 0x08,
      RomImageDeleteMode_Signature_Number   : 0x09,
      RomImageDeleteMode_MessageBox_Number  : 0x0a
    }

    Protocol.prototype.OperationModeType =
    {
      OperationModeType_Normal: 0x00, // Tablet will return PenData
      OperationModeType_PinPad: 0x01, // Tablet will return PinPadData
      OperationModeType_SlideShow: 0x02, // Tablet will display bitmaps and not return pen data
      OperationModeType_KeyPad: 0x03, // Tablet will return KeyPadData
      OperationModeType_Signature: 0x04, // Tablet will display signature capture screen and buttons
      OperationModeType_MessageBox: 0x05  // not used in setOperationMode, @see setRomStartImage
    }

    Protocol.prototype.ImageDataBlock_maxLengthHID = 253;
    Protocol.prototype.ImageDataBlock_maxLengthSerial = 2557;
    Protocol.prototype.ImageDataBlock_maxLength540 = 2557;
 
    Protocol.prototype.toJSON = function() {
      return {"id": id, "scope": scope};
    }
 
    Protocol.prototype.Constructor = function (_intf) {
      intf = _intf;
      return WacomGSS.STU.send
          ({
      "scope": scope, 
      "function": "Constructor", 
      "intf": intf.toJSON()
    })
    .then( function(message) {
      id = message.id;
      return message;
    });
    }
    
    Protocol.prototype.getInterface = function() {
      return intf;
    }
    
    Protocol.prototype.getInformation = function () {
      return WacomGSS.STU.send
          ({
            "scope": scope, 
            "id": id, 
            "function": "getInformation"
          });
    }
    
    Protocol.prototype.getPenDataOptionMode = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getPenDataOptionMode"
             });
    }
    // pendDataOptionMode is a Protocol.PenDataOptionMode
    Protocol.prototype.setPenDataOptionMode = function(penDataOptionMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id, 
               "function": "setPenDataOptionMode", 
               "penDataOptionMode": penDataOptionMode
             });
    }
    
    Protocol.prototype.OperationMode_Normal = (function () {
      function OperationMode_Normal() {
        this.operationMode = 0x00; // Protocol.OperationModeType.OperationModeType_Normal
        this.data = [];
      }

      return OperationMode_Normal;
    })();

    // screenSelect     1..3
    // pinBypass        When bypass is enable, digit 0 is approved if minDigit is not 0
    // minDigit         0..12  (minimum digit must be less than maximum digit)
    // maxDigit         0..12
    // numberHiddenMode 0=disable, 1=enable (number is changed to *)
    // idAfterEnter     0=blank screen; 1-6 message box screen
    // idAfterCancel    0=blank screen; 1-6 message box screen
    Protocol.prototype.OperationMode_PinPad = (function () {
      function OperationMode_PinPad(screenSelect, pinBypass, minDigit, maxDigit, numberHiddenMode, idAfterEnter, idAfterCancel) {
        this.operationMode = 0x01; // Protocol.OperationModeType.OperationModeType_PinPad
        this.data = [];

        this.data[0] = screenSelect;
        this.data[1] = Number(pinBypass);
        this.data[2] = minDigit;
        this.data[3] = maxDigit;
        this.data[4] = Number(numberHiddenMode);
        this.data[5] = idAfterEnter;
        this.data[6] = idAfterCancel;
      }

      return OperationMode_PinPad;
    })();


    // workingMode      0=round robin (need to set number and slideNumber accordingly); 1-10=slide number (only one slide shown)
    // numberOfSlides   2..10 number of slides to show
    // slideNumber      array of numbers of slides to show
    // interval         2..120 interval in seconds.
    Protocol.prototype.OperationMode_SlideShow = (function () {
      function OperationMode_SlideShow(workingMode, numberOfSlides, slideNumber, interval) {
        this.operationMode = 0x02;    // Protocol.OperationModeType.OperationModeType_SlideShow,
        this.data = [];

        this.data[0] = workingMode;
        this.data[1] = numberOfSlides;

        this.data[2] = ((slideNumber[0] & 0x0f) << 4) | (slideNumber[1] & 0x0f);
        this.data[3] = ((slideNumber[2] & 0x0f) << 4) | (slideNumber[3] & 0x0f);
        this.data[4] = ((slideNumber[4] & 0x0f) << 4) | (slideNumber[5] & 0x0f);
        this.data[5] = ((slideNumber[6] & 0x0f) << 4) | (slideNumber[7] & 0x0f);
        this.data[6] = ((slideNumber[8] & 0x0f) << 4) | (slideNumber[9] & 0x0f);

        this.data[7] = ((interval >> 24) & 0xff);
        this.data[8] = ((interval >> 16) & 0xff);
        this.data[9] = ((interval >> 8) & 0xff);
        this.data[10] = ((interval) & 0xff);
      }

      return OperationMode_SlideShow;
    })();


    // screenSelect   1..3
    // idAfterSelect  0=blank screen; 1-6 message box screen
    Protocol.prototype.OperationMode_KeyPad = (function() {
      function OperationMode_KeyPad(screenSelect, idAfterSelect) {
        this.operationMode = 0x03;    // Protocol.OperationModeType.OperationModeType_KeyPad,
        this.data = [];

        this.data[0] = screenSelect;
        this.data[1] = idAfterSelect;
      }

      return OperationMode_KeyPad;
    })();


    // signatureScreen  1 to 3: screen pattern select
    // keyDefinition    0=Cancel; 1=Enter; 2=Clear. The 3 keys must be defined differently
    // idAfterEnter     0=blank screen; 1-6 message box screen
    // idAfterCancel    0=blank screen; 1-6 message box screen
    Protocol.prototype.OperationMode_Signature = (function () {
      function OperationMode_Signature(signatureScreen, keyDefinition, idAfterEnter, idAfterCancel) {
        this.operationMode = 0x04;    // Protocol.OperationModeType.OperationModeType_Signature,
        this.data = [];

        this.data[0] = signatureScreen;
        this.data[1] = keyDefinition[0];
        this.data[2] = keyDefinition[1];
        this.data[3] = keyDefinition[2];
        this.data[4] = idAfterEnter;
      }

      return OperationMode_Signature;
    })();

    // operationMode is OperationMode_Normal, _PinPad, _SlideShow, _KeyPad or _Signature
    Protocol.prototype.setOperationMode = function (operationMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setOperationMode",
               "operationMode": operationMode
             });
    }

    Protocol.prototype.getOperationMode = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getOperationMode",
             });
    }

    Protocol.prototype.RomStartImageData_PinPad = (function () {
      // encodingMode Protocol.EncodingMode (must be 24-bit)
      // imageType    false=not pushed; true=pushed 
      // imageNumber  1..3
      // padType      1 = numbers only; 2 = include '*' & '#' keys; 3 =  include '.' & '00' keys
      // keyLayout    1..5
      function RomStartImageData_PinPad(encodingMode, imageType, imageNumber, padType, keyLayout) {
        this.encodingMode = encodingMode;
        this.operationMode = 0x01; // Protocol.OperationModeType.OperationModeType_PinPad
        this.imageType = imageType;
        this.imageNumber = imageNumber;
        this.data = [padType, keyLayout, 0];
      }

      return RomStartImageData_PinPad;
    })();

    Protocol.prototype.RomStartImageData_SlideShow = (function () {
      // encodingMode Protocol.EncodingMode (must be 24-bit)
      // imageType    not used
      // imageNumber  1..10
      function RomStartImageData_SlideShow(encodingMode, imageType, imageNumber) {
        this.encodingMode = encodingMode;
        this.operationMode = 0x02; // Protocol.OperationModeType.OperationModeType_SlideShow
        this.imageType = imageType;
        this.imageNumber = imageNumber;
        this.data = [0, 0, 0];
      }

      return RomStartImageData_SlideShow;
    })();

    Protocol.prototype.RomStartImageData_KeyPad = (function () {
      // encodingMode Protocol.EncodingMode (must be 24-bit)
      // imageType    false=not pushed; true=pushed
      // imageNumber  1..3
      // padType      1 = 9 button layout; 2 = 6 button layout; 3 = 4 button layout
      // keyEnabled   array of 9, 6 or 4 key enabled states
      function RomStartImageData_KeyPad(encodingMode, imageType, imageNumber, padType, keyEnabled) {
        this.encodingMode = encodingMode;
        this.operationMode = 0x03; // Protocol.OperationModeType.OperationModeType_KeyPad
        this.imageType = imageType;
        this.imageNumber = imageNumber;
        this.data = [];
        this.data[0] = padType;
        this.data[1] = (keyEnabled.length > 8 && keyEnabled[8]) ? 0x01 : 0;
        this.data[2] = ((keyEnabled.length > 7 && keyEnabled[7]) ? 0x80 : 0) |
                       ((keyEnabled.length > 6 && keyEnabled[6]) ? 0x40 : 0) |
                       ((keyEnabled.length > 5 && keyEnabled[5]) ? 0x20 : 0) |
                       ((keyEnabled.length > 4 && keyEnabled[4]) ? 0x10 : 0) |
                       ((keyEnabled.length > 3 && keyEnabled[3]) ? 0x08 : 0) |
                       ((keyEnabled.length > 2 && keyEnabled[2]) ? 0x04 : 0) |
                       ((keyEnabled.length > 1 && keyEnabled[1]) ? 0x02 : 0) |
                       ((keyEnabled.length > 0 && keyEnabled[0]) ? 0x01 : 0);
      }

      return RomStartImageData_KeyPad;
    })();

    Protocol.prototype.RomStartImageData_Signature = (function () {
      // encodingMode Protocol.EncodingMode (must be 24-bit)
      // imageType    false=not pushed; true=pushed
      // imageNumber  1..3
      // keyEnabled   
      function RomStartImageData_Signature(encodingMode, imageType, imageNumber, keyEnabled) {
        this.encodingMode = encodingMode;
        this.operationMode = 0x04; // Protocol.OperationModeType.OperationModeType_Signature  
        this.imageType = imageType;
        this.imageNumber = imageNumber;
        this.data = [];
        this.data[0] =  (keyEnabled[2] ? 0x04 : 0) |
                        (keyEnabled[1] ? 0x02 : 0) |
                        (keyEnabled[0] ? 0x01 : 0);
      }

      return RomStartImageData_Signature;
    })();

    Protocol.prototype.RomStartImageData_MessageBox = (function () {
      // encodingMode Protocol.EncodingMode (must be 24-bit)
      // imageType    not used
      // imageNumber  1..6
      function RomStartImageData_MessageBox(encodingMode, imageNumber) {
        this.encodingMode = encodingMode;
        this.operationMode = 0x05; // Protocol.OperationModeType.OperationModeType_MessageBox  
        this.imageType = false;
        this.imageNumber = imageNumber;
        this.data = [0, 0, 0];
      }

      return RomStartImageData_MessageBox;
    }) ();


    // romStartImage type is Protocol.RomStartImageData_PinPad, _SlideShow, _KeyPad, _Signature or _MessageBox
    Protocol.prototype.setRomStartImageData = function (romStartImage) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setRomStartImageData",
               "romStartImage": romStartImage,
             });
    }

    // operationModeType is Protocol.OperationModeType value
    // imageType    false=not pushed; true=pushed
    // imageNumber  1..10 depending on operation mode
    Protocol.prototype.setRomImageHash = function (operationModeType, imageType, imageNumber) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setRomImageHash",
               "operationModeType": operationModeType, 
               "imageType": imageType, 
               "imageNumber": imageNumber
             });
    }

    Protocol.prototype.getRomImageHash = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getRomImageHash",
             });
    }

    // romImageDeleteMode is Protocol.RomImageDeleteMode value
    // imageType    false=not pushed; true=pushed
    // imageNumber  1..10 depending on delete mode
    Protocol.prototype.setRomImageDelete = function (romImageDeleteMode, imageType, imageNumber) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setRomImageDelete",
               "romImageDeleteMode": romImageDeleteMode, 
               "imageType": imageType, 
               "imageNumber": imageNumber
             });
    }

    Protocol.prototype.getCurrentImageArea = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getCurrentImageArea"
             });
    }

    // operationModeType is Protocol.OperationModeType value
    // imageType    false=not pushed; true=pushed
    // imageNumber  1..10 depending on operationModeType mode
    Protocol.prototype.setRomImageDisplay = function (operationModeType, imageType, imageNumber) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setRomImageDisplay",
               "operationModeType": operationModeType,
               "imageType": imageType,
               "imageNumber": imageNumber
             });
    }

    Protocol.prototype.getEserial = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getEserial",
             });
    }

    Protocol.prototype.setClearScreen = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setClearScreen"
             });
    }
    // inkingMode is a Protocol.InkingMode
    Protocol.prototype.setInkingMode = function (inkingMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setInkingMode", 
               "inkingMode": inkingMode
             });
    }
    // intf type is WacomGSS.STU.UsbInterface or WacomGSS.STU.SerialInterface
    Protocol.prototype.rebind = function (_intf) {
      var foo = _intf;
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "rebind",
               "intf": _intf.toJSON()
             })
             .then( function(message) {
               if(null === message) {
                 intf = foo;
               }
             });
    }
 
    Protocol.prototype.getStatus = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getStatus"
             });
    }
    // flag type is WacomGSS.STU.Protocol.ResetFlag
    Protocol.prototype.setReset = function (flag) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setReset",
               "flag": flag
             });
    }
 
    Protocol.prototype.getHidInformation = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHidInformation"
             });
    }
 
    Protocol.prototype.getCapability = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getCapability"
             });
    }
     
    Protocol.prototype.getUid = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getUid"
             });
    }
    // uid is an integer
    Protocol.prototype.setUid = function(uid) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setUid",
               "uid": uid
             });
    }
 
    Protocol.prototype.getUid2 = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getUid2"
             });
    }
    // defaultMode type is Protocol.DefaultMode 
    Protocol.prototype.setDefaultMode = function(defaultMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setDefaultMode",
               "defaultMode": defaultMode
             });
    }
     
    Protocol.prototype.getDefaultMode = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getDefaultMode"
             });
    }
    
    Protocol.prototype.getHostPublicKey = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHostPublicKey"
             });
    }
     // hostPublicKey is an integer Array[16] 
    Protocol.prototype.setHostPublicKey = function(hostPublicKey) {
      return WacomGSS.STU.send
             ({
              "scope": scope, 
               "id": id, 
               "function": "setHostPublicKey",
               "hostPublicKey": hostPublicKey
             });
    }
     
    Protocol.prototype.getDevicePublicKey = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
              "function": "getDevicePublicKey"
             });
    }
    // sessionId is an integer
    Protocol.prototype.setStartCapture = function(sessionId) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setStartCapture",
               "sessionId": sessionId
             });
    }
     
    Protocol.prototype.setEndCapture = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setEndCapture"
             });
    }
     
    Protocol.prototype.getDHprime = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getDHprime"
             });
    }
    // prime is an integer Array [16]
    Protocol.prototype.setDHprime = function(prime) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setDHprime",
               "prime": prime
             });
    }
     
    Protocol.prototype.getDHbase = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getDHbase"
             });
    }
    // base is an integer Array [2]
    Protocol.prototype.setDHbase = function(prime) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setDHbase",
               "base": base
             });
    }
    // area is a Protocol.Rectangle
    Protocol.prototype.setClearScreenArea = function(area) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setClearScreenArea",
               "area": area
             });
    }
     
    Protocol.prototype.getInkingMode = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getInkingMode"
             });
    }
     
    Protocol.prototype.getInkThreshold = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getInkThreshold"
             });
    }
     // inkThreshold type is Protocol.InkThreshold
    Protocol.prototype.setInkThreshold = function(inkThreshold) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setInkThreshold",
               "inkThreshold": inkThreshold
             });
    }
    // encodingMode type is Protocol.EncodingMode
    Protocol.prototype.setStartImageData = function(encodingMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setStartImageData",
               "encodingMode": encodingMode
             });
    }
    // encodingMode type is Protocol.EncodingMode
    // area type is Protocol.Rectangle
    Protocol.prototype.setStartImageDataArea = function(encodingMode, area) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setStartImageDataArea",
               "encodingMode": encodingMode,
               "area": area
             });
    }
    // imageDataBlock is a Base64-encoded string, where the underlying data maximum size is 2557 bytes
    Protocol.prototype.setImageDataBlock = function(imageDataBlock) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setEndImageData",
               "imageDataBlock": imageDataBlock
             });
    }
    // endImageDataFlag type is Protocol.EndImageDataFlag
    Protocol.prototype.setEndImageData = function(encodingMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setEndImageData",
               "endImageDataFlag": endImageDataFlag
             });
    }
     
    Protocol.prototype.getHandwritingThicknessColor = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHandwritingThicknessColor"
             });
    }
    // handwritingThicknessColor type is Protocol.HandwritingThicknessColor
    Protocol.prototype.setHandwritingThicknessColor = function(handwritingThicknessColor) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setHandwritingThicknessColor",
               "handwritingThicknessColor" : handwritingThicknessColor
             });
    }
     
    Protocol.prototype.getHandwritingThicknessColor24 = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHandwritingThicknessColor24"
             });
    }
    // handwritingThicknessColor24 type is Protocol.HandwritingThicknessColor24
    Protocol.prototype.setHandwritingThicknessColor24 = function(handwritingThicknessColor24) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setHandwritingThicknessColor24",
               "handwritingThicknessColor24": handwritingThicknessColor24
             });
    }
     
    Protocol.prototype.getBackgroundColor = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getBackgroundColor"
             });
    }
    // backgroundColor type is Integer
    Protocol.prototype.setBackgroundColor = function(backgroundColor) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setBackgroundColor",
               "backgroundColor" : backgroundColor
             });
    }
     
    Protocol.prototype.getBackgroundColor24 = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getBackgroundColor24"
             });
    }
     // backgroundColor24 type is Integer
    Protocol.prototype.setBackgroundColor24 = function(backgroundColor24) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setBackgroundColor24",
               "backgroundColor24" : backgroundColor24
             });
    }
     
    // governs operation of boot screen image display
    Protocol.prototype.BootScreenFlag =
    {
      Disable : 0x00,
      Enable  : 0x01
    }

    // sets whether the boot image is shown at start up.
    Protocol.prototype.setBootScreen = function(bootScreenFlag) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setBootScreen",
               "bootScreenFlag": bootScreenFlag
             });
    }

    // retrieves whether the boot image is shown at start up.
    Protocol.prototype.getBootScreen = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getBootScreen"
             });
    }


    Protocol.prototype.getHandwritingDisplayArea = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHandwritingDisplayArea"
             });
    }
    // handwritingDisplayArea type is Protocol.Rectangle
    Protocol.prototype.setHandwritingDisplayArea = function(handwritingDisplayArea) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setHandwritingDisplayArea",
               "handwritingDisplayArea" : handwritingDisplayArea
             });
    }
     
    Protocol.prototype.getBacklightBrightness = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getBacklightBrightness"
             });
    }
    // backlightBrightness type is Integer
    Protocol.prototype.setBacklightBrightness = function(backlightBrightness) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setBacklightBrightness",
               "backlightBrightness" : backlightBrightness
             });
    }
     
    Protocol.prototype.getScreenContrast = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getScreenContrast"
             });
    }
    // screenContrast type is Integer
    Protocol.prototype.setScreenContrast = function(screenContrast) {
      return WacomGSS.STU.send
              ({
               "scope": scope, 
               "id": id, 
               "function": "setScreenContrast",
               "screenContrast" : screenContrast
             });
    }
     
    Protocol.prototype.getEncryptionStatus = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getEncryptionStatus"
             });
    }
    Protocol.prototype.EncryptionCommand = ( function() {
      var scope = "WacomGSS.STU.Protocol";
       
      function copyData(other)
      {
        this.encryptionCommandNumber = other.encryptionCommandNumber; 
        this.parameter = other.parameter;              
        this.lengthOrIndex = other.lengthOrIndex;           
        this.data = other.data;                   
      }
     
      function EncryptionCommand() {
        this.encryptionCommandNumber = 0; // type is Protocol.EncryptionCommandNumber
        this.parameter = 0;               // unsigned 8-bit integer
        this.lengthOrIndex = 0;           // unsigned 8-bit integer
        this.data = [];                   // array of 64 unsigned 8-bit integers (512 bits)
      }
       
      // symmetricKeyType type is Protocol.SymmetricKeyType
      // asymmetricPaddingType type is Protocol.AsymmetricPaddingType
      // asymmetricKeyType type is Protocol.AsymmetricKeyType
      EncryptionCommand.prototype.initializeSetEncryptionType = function(symmetricKeyType, asymmetricPaddingType, asymmetricKeyType) {
        return WacomGSS.STU.send
               ({
                 "scope": scope, 
                 "function": "EncryptionCommand_initializeSetEncryptionType",
                 "symmetricKeyType": symmetricKeyType,
                 "asymmetricPaddingType": asymmetricPaddingType,
                 "asymmetricKeyType": asymmetricKeyType
               })
               .then( function(message) {
                 copyData.call(this, message);
                 return this;
               });
      }
   
      // index type is EncryptionCommandParameterBlockIndex
      // data is an integer array
      EncryptionCommand.prototype.initializeSetParameterBlock = function(index, data) {
        return WacomGSS.STU.send
               ({
                 "scope": scope, 
                 "function": "EncryptionCommand_initializeSetParameterBlock",
                 "index": index,
                 "data": data
               })
               .then( function(message) {
                 copyData.call(this, message);
                 return this;
               });
      }
   
      EncryptionCommand.prototype.initializeGenerateSymmetricKey = function() {
        return WacomGSS.STU.send
               ({
                 "scope": scope, 
                 "function": "EncryptionCommand_initializeGenerateSymmetricKey"
               })
               .then( function(message) {
                 copyData.call(this, message);
                 return this;
               });
      }
   
      // index type is EncryptionCommandParameterBlockIndex
      // offset is an integer
      EncryptionCommand.prototype.initializeGetParameterBlock = function(index, offset) {
        return WacomGSS.STU.send
               ({
                 "scope": scope, 
                 "function": "EncryptionCommand_initializeGetParameterBlock"
               })
               .then( function(message) {
                 copyData.call(this, message);
                 return this;
               });
      }
   
    return EncryptionCommand;
  })();
  // encryptionCommandNumber type is Protocol.EncryptionCommandNumber
  Protocol.prototype.getEncryptionCommand = function(encryptionCommandNumber) {
    return WacomGSS.STU.send
           ({
             "scope": scope, 
             "id": id, 
             "function": "getEncryptionCommand",
             "encryptionCommandNumber": encryptionCommandNumber
           });
  }
 
  Protocol.prototype.getReportSizeCollection = function() {
    return WacomGSS.STU.send
           ({
             "scope": scope, 
             "id": id, 
             "function": "getReportSizeCollection"
           });
  }
  // reportRate is an integer
  Protocol.prototype.setReportRate = function(reportRate) {
    return WacomGSS.STU.send
           ({
             "scope": scope, 
             "id": id, 
             "function": "setReportRate",
             "reportRate": reportRate
           });
  }
 
  Protocol.prototype.getReportRate = function() {
    return WacomGSS.STU.send
           ({
             "scope": scope, 
             "id": id, 
             "function": "getReportRate"
           });
  }

  // Selects ink algorithm to use
  Protocol.prototype.RenderingMode =
  {
    RenderingMode_Legacy : 0x00, // legacy rendering (default)
    RenderingMode_WILL   : 0x01  // high quality WILL rendering
  }
 
  // renderingMode is Protocol.RenderingMode
  Protocol.prototype.setRenderingMode = function(renderingMode) {
    return WacomGSS.STU.send
           ({
             "scope": scope, 
             "id": id, 
             "function": "setRenderingMode",
             "renderingMode" : renderingMode
           });
  }

  Protocol.prototype.getRenderingMode = function() {
    return WacomGSS.STU.send
           ({
             "scope": scope,
             "id": id,
             "function": "getRenderingMode"
           });
  }

    return Protocol;
  }) ();

  STU.prototype.ProtocolHelper =
  {
    ReportHandler :  (function() {
    var scope = "WacomGSS.STU.ProtocolHelper.ReportHandler";
    var streamId = null; 
    var id = null; 
   
    function ReportHandler(){
      this.onReportPenData = function(message) {};
      this.onReportPenDataOption = function(message) {};
      this.onReportPenDataTimeCountSequence = function(message) {};
      this.onReportPenDataEncrypted = function(message) {};
      this.onReportPenDataEncryptedOption = function(message) {};
      this.onReportPenDataTimeCountSequenceEncrypted = function(message) {};
      this.onReportDevicePublicKey = function(message) {};
      this.onReportEncryptionStatus = function (message) { };
      this.onReportEventDataPinPad = function (message) { };
      this.onReportEventDataKeyPad = function (message) { };
      this.onReportEventDataSignature = function (message) { };
      this.onReportEventDataPinPadEncrypted = function (message) { };
      this.onReportEventDataKeyPadEncrypted = function (message) { };
      this.onReportEventDataSignatureEncrypted = function (message) { };

      this.decrypt = function(message) {};
      this.tabletDisconnected = function (message) {};

      this.stream = function (message) {
        var protocol = new WacomGSS.STU.Protocol();
        switch(message.reportId) {
          case protocol.ReportId.ReportId_PenData:
            this.onReportPenData(message);
            break;
          case protocol.ReportId.ReportId_PenDataOption:
            this.onReportPenDataOption(message);
            break;
          case protocol.ReportId.ReportId_PenDataTimeCountSequence:
            this.onReportPenDataTimeCountSequence(message);
            break;
          case protocol.ReportId.ReportId_PenDataEncrypted:
            this.onReportPenDataEncrypted(message);
            break;
          case protocol.ReportId.ReportId_PenDataEncryptedOption:
            this.onReportPenDataEncryptedOption(message);
            break;
          case protocol.ReportId.ReportId_PenDataTimeCountSequenceEncrypted:
            this.onReportPenDataTimeCountSequenceEncrypted(message);
            break;
          case protocol.ReportId.ReportId_DevicePublicKey:
            this.onReportDevicePublicKey(message);
            break;
          case protocol.ReportId.ReportId_EncryptionStatus:
            this.onReportEncryptionStatus(message);
            break;
          case protocol.ReportId.ReportId_EventData:
            this.onEventData(protocol, message);
            break;
          case protocol.ReportId.ReportId_EventDataEncrypted:
            this.onEventDataEncrypted(protocol, message);
            break;

          case protocol.ReportId.SigCaptX_Decrypt:
            this.decrypt(message);
            break;
          case protocol.ReportId.SigCaptX_TabletDisconnected:
            this.tabletDisconnected(message);
            break;

          default:
            break;
        }
      }
    }
   
    // _interfaceQueueHolder can be a UsbInterface, SerialInterface or Tablet
    // tabletDecrypt is a Boolean. If true it will set callback to tablet.decrypt()
    ReportHandler.prototype.startReporting = function (_interfaceQueueHolder, tabletDecrypt) {
      streamId = WacomGSS.STU.setStream(this);
      return WacomGSS.STU.send
             ({
               "interfaceQueueHolder": _interfaceQueueHolder.toJSON(),
               "scope": scope, 
               "function": "startReporting", 
               "streamId": streamId,
               "tabletDecrypt" : (true === tabletDecrypt)
             })
             .then( function(message) {
               id = message.id;
               return message;
             });
    }
   
    ReportHandler.prototype.stopReporting = function () {
      if(null === streamId) {
        throw "Error: trying to stop reporting before starting";
      }
      return WacomGSS.STU.send
             ({
               "id": id,
               "scope": scope, 
               "function": "stopReporting"
             })
             .then( function(message) {
               WacomGSS.STU.removeStream(streamId);
               return message;
             });
    }
 
    ReportHandler.prototype.onEventData = function (protocol, message) {
      switch (message.operationModeType)
      {
        case protocol.OperationModeType.OperationModeType_PinPad:
          this.onReportEventDataPinPad(message);
          break;
        case protocol.OperationModeType.OperationModeType_KeyPad:
          this.onReportEventDataKeyPad(message);
          break;
        case protocol.OperationModeType.OperationModeType_Signature:
          this.onReportEventDataSignature(message);
          break;
        default:
          break;
      }
    }

    ReportHandler.prototype.onEventDataEncrypted = function (protocol, message) {
      switch (message.operationModeType) {
        case protocol.OperationModeType.OperationModeType_PinPad:
          this.onReportEventDataPinPadEncrypted(message);
          break;
        case protocol.OperationModeType.OperationModeType_KeyPad:
          this.onReportEventDataKeyPadEncrypted(message);
          break;
        case protocol.OperationModeType.OperationModeType_Signature:
          this.onReportEventDataSignatureEncrypted(message);
          break;
        default:
          break;
      }
    }

    return ReportHandler;
            
    })(),
    InkState_isOff   : 0x01,
    InkState_isOn    : 0x02,
    InkState_isInk   : 0x04,
    InkState_isFirst : 0x08,
    InkState_isLast  : 0x10,
    InkState : 
              {
                //               InkState_isOff|InkState_isOn|InkState_isInk|InkState_isFirst|InkState_isLast
                InkState_Up     : 0x01                                                            ,  // No ink is being drawn
                InkState_Down   :               0x02                                              ,  // No ink is being drawn
                InkState_Inking :               0x02         |0x04                                ,  // Ink is being drawn
                InkState_First  :               0x02         |0x04          |0x08                 ,  // This is the first point of ink to draw.
                InkState_Last   : 0x01         |                                              0x10   // This marks that inking has finished. You should not draw this point.
              },
    OpDirection : 
                 {
                   OpDirection_Get : 0x0100,
                   OpDirection_Set : 0x0200
                 },
    // statusCode is an Integer
    // reportId is an Integer
    // opDirection type is ProtocolHelper.OpDirection
    statusCanSend : function(statusCode, reportId, opDirection) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.ProtocolHelper",
               "function": "statusCanSend",
               "statusCode": statusCode,
               "reportId": reportId,
               "opDirection": opDirection
             })
    },
    // protocol type is WacomGSS.STU.Procotol
    // reportId type is Protocol.ReportId
    // opDirection type is ProtocolHelper.OpDirection
    // retries is an Integer
    // sleepBetweenRetries is an Integer (milliseconds)
    waitForStatusToSend : function(protocol, reportId, opDirection, retries, sleepBetweenRetries) {
      var deferred = Q.defer();
      function myLoop() {
        protocol.getStatus()
        .then(function (status) {
          return WacomGSS.STU.ProtocolHelper.statusCanSend(status.statusCode, reportId, opDirection);
        })
        .then( function(canSend) {
          if (true === canSend) {
            deferred.resolve();
            return;
          }
          if (retries <= 0) {
            deferred.reject(new Error("timeout error"));
            return;
          }
          retries--;
          setTimeout(myLoop, sleepBetweenRetries);
        });
      }
      setTimeout(myLoop, 0);
      return deferred.promise;
    },
    // protocol type is WacomGSS.STU.Procotol
    // statusCode type is Protocol.StatusCode
    // retries is an Integer
    // sleepBetweenRetries is an Integer (milliseconds)
    waitForStatus : function(protocol, statusCode, retries, sleepBetweenRetries)   {
      var deferred = Q.defer();
      function myLoop() {
        protocol.getStatus()
        .then( function(status) {
          if (status.statusCode === statusCode) {
            deferred.resolve();
            return;
          }
          if (retries <= 0) {
            deferred.reject(new Error("timeout error"));
            return;
          }
          retries--;
          setTimeout(myLoop, sleepBetweenRetries);
        });
      }
      setTimeout(myLoop, 0);
      return deferred.promise;
    },
    // protocol type is WacomGSS.STU.Procotol
    supportsEncryption : function(protocol) {
      var opDirection = WacomGSS.STU.ProtocolHelper.OpDirection.OpDirection_Get;
      return WacomGSS.STU.ProtocolHelper.waitForStatusToSend(protocol, WacomGSS.STU.Protocol.ReportId.ReportId_DHprime, opDirection, 25, 50)
             .then( function(message) {
               return  WacomGSS.STU.send
                       ({
                         "scope": "WacomGSS.STU.ProtocolHelper", 
                         "function": "supportsEncryption",
                         "protocol": protocol
                       });
             });
    }, 
    // dhPrime is an Integer array (16 bytes)
    supportsEncryption_DHprime : function(dhPrime) {
      return  WacomGSS.STU.send
              ({
                "scope": "WacomGSS.STU.ProtocolHelper", 
                "function": "supportsEncryption_DHprime",
                "dhPrime": dhPrime
              });
    },
    // protocol type is WacomGSS.STU.Procotol
    // hostPublicKey type is an Integer Array (16 bytes)
    // retries is an Integer
    // sleepBetweenRetries is an Integer (milliseconds)
    setHostPublicKeyAndPollForDevicePublicKey : function(protocol, hostPublicKey, retries, sleepBetweenRetries) {
      return protocol.setHostPublicKey(hostPublicKey)
             .then( function(message) {
               var opDirection = WacomGSS.STU.ProtocolHelper.OpDirection.OpDirection_Get;
               return WacomGSS.STU.ProtocolHelper.waitForStatusToSend(protocol, WacomGSS.STU.Protocol.ReportId.ReportId_DevicePublicKey, opDirection, retries, sleepBetweenRetries);
             })
             .then( function(message) {
               return protocol.getDevicePublicKey();
             })
             .then( function(message) {
               if(message.length !== hostPublicKey.length) {
                 throw new Error("Unexpected key size");
               }
               return message;
             });
    },
    // protocol type is WacomGSS.STU.Procotol
    // encodingMode type is Protocol.EncodingMode
    // imageData type is a base64-encoded image string, or a DataStore reference to it
    // retries is an Integer
    // sleepBetweenRetries is an Integer (milliseconds)
    writeImage : function(protocol, encodingMode, imageData, retries, sleepBetweenRetries) {
      retries = (typeof retries === 'undefined')? 25 : retries;
      sleepBetweenRetries = (typeof sleepBetweenRetries === 'undefined')? 25 : sleepBetweenRetries;
      var opDirection = WacomGSS.STU.ProtocolHelper.OpDirection.OpDirection_Set;
      return WacomGSS.STU.ProtocolHelper.waitForStatusToSend(protocol, WacomGSS.STU.Protocol.ReportId.ReportId_StartImageData, opDirection, retries, sleepBetweenRetries)
             .then( function(message){
                return protocol.setStartImageData(encodingMode);
              })
             .then( function(message){
               var maxImageBlockSize = protocol.ImageDataBlock_maxLengthHID;
               return WacomGSS.STU.ProtocolHelper.writeImageCommon(protocol, encodingMode, maxImageBlockSize, imageData, retries, sleepBetweenRetries);
             });
    },
    // protocol type is WacomGSS.STU.Procotol
    // encodingMode type is Protocol.EncodingMode
    // maxImageBlockSize type is Integer
    // imageData type is a base64-encoded image string, or a DataStore reference to it
    // retries is an Integer
    // sleepBetweenRetries is an Integer (milliseconds)
    writeImageCommon : function(protocol, encodingMode, maxImageBlockSize, imageData, retries, sleepBetweenRetries) {
      if(maxImageBlockSize > protocol.ImageDataBlock_maxLengthSerial) {
        throw new Error("Invalid maxImageBlockSize");
      }
      var opDirection = WacomGSS.STU.ProtocolHelper.OpDirection.OpDirection_Set;
      return WacomGSS.STU.ProtocolHelper.waitForStatusToSend(protocol, WacomGSS.STU.Protocol.ReportId.ReportId_ImageDataBlock, opDirection, retries, sleepBetweenRetries)
             .then( function(message) {
               return WacomGSS.STU.send
                      ({
                        "scope": "WacomGSS.STU.ProtocolHelper", 
                        "function": "writeImageCommon",
                        "protocol": protocol.toJSON(),
                        "intf": protocol.getInterface().toJSON(),
                        "encodingMode": encodingMode,
                        "imageData": imageData,
                        "maxImageBlockSize": maxImageBlockSize
                      });
             });
    },
    // b64Data type is a base64-encoded image string, or a DataStore reference to it
    // screenWidth type is Integer
    // screenHeight type is Integer
    // dataStore type is Boolean. If true, flattenMonochrome will return a DataStore object, otherwise it will return the raw b64-encoded data
    flattenMonochrome : function(b64Data, screenWidth, screenHeight, dataStore) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.ProtocolHelper",
              "function": "flattenMonochrome",
               "b64Data": b64Data,
               "screenWidth": screenWidth,
               "screenHeight": screenHeight,
               "dataStore": (true === dataStore? true : false)
             })
             .then( function(message) {
               if('string' === typeof message) {
                 return message;
               }
               var dataStore = new WacomGSS.STU.DataStore();
               dataStore.setId(message.id);
               return dataStore;
             });
    },
    // encodingMode type is Protocol.EncodingMode
    // b64Data type is a base64-encoded image string, or a DataStore reference to it
    // screenWidth type is Integer
    // screenHeight type is Integer
    // dataStore type is Boolean. If true, resizeAndFlatten will return a DataStore object, otherwise it will return the raw b64-encoded data
    flatten : function(encodingMode, b64Data, screenWidth, screenHeight, dataStore) {
      var p = new WacomGSS.STU.Protocol();
      switch (encodingMode) {
           case p.EncodingMode.EncodingMode_24bit:
           case p.EncodingMode.EncodingMode_24bit_Bulk:
             return WacomGSS.STU.ProtocolHelper.flattenColor24(b64Data, screenWidth, screenHeight, dataStore);
             break;
           case p.EncodingMode.EncodingMode_16bit:
           case p.EncodingMode.EncodingMode_16bit_Bulk:
             return WacomGSS.STU.ProtocolHelper.flattenColor16(b64Data, screenWidth, screenHeight, dataStore);
             break;
           case p.EncodingMode.EncodingMode_1bit:
           case p.EncodingMode.EncodingMode_1bit_Bulk:
             return WacomGSS.STU.ProtocolHelper.flattenMonochrome(b64Data, screenWidth, screenHeight, dataStore);
             break;
      }
    },
    // b64Data type is a base64-encoded image string, or a DataStore reference to it
    // offsetX type is Integer
    // offsetY type is Integer
    // bitmapWidth type is Integer
    // bitmapHeight type is Integer
    // screenWidth type is Integer
    // screenHeight type is Integer
    // encodingMode type is Integer
    // scale type is Integer
    // backgroundColor type is Integer
    // clip type is Integer
    // dataStore type is Boolean. If true, resizeAndFlatten will return a DataStore object, otherwise it will return the raw b64-encoded data
    resizeAndFlatten : function(b64Data, offsetX, offsetY, bitmapWidth, bitmapHeight, screenWidth, screenHeight, encodingMode, scale, backgroundColor, clip, dataStore){
       return WacomGSS.STU.send
              ({
                "scope": "WacomGSS.STU.ProtocolHelper",
                "function": "resizeAndFlatten",
                "b64Data": b64Data,
                "offsetX": offsetX,
                "offsetY": offsetY,
                "bitmapWidth": bitmapWidth,
                "bitmapHeight": bitmapHeight,
                "screenWidth": screenWidth,
                "screenHeight": screenHeight,
                "encodingMode": encodingMode,
                "scale": scale,
                "backgroundColor": backgroundColor,
                "clip": clip,
                "dataStore": (true === dataStore? true : false)
              })
              .then( function(message) {
                if('string' === typeof message) {
                  return message;
                }
                var dataStore = new WacomGSS.STU.DataStore();
                dataStore.setId(message.id);
                return dataStore;
              });
    },
    // screenWidth type is Integer
    encodingFlagSupportsColor: function(screenWidth) {
      return WacomGSS.STU.send
            ({
              "scope": "WacomGSS.STU.ProtocolHelper",
              "function": "encodingFlagSupportsColor",
              "screenWidth": screenWidth
            });
    },
    // b64Data type is a base64-encoded image string, or a DataStore reference to it
    // screenWidth type is Integer
    // screenHeight type is Integer
    // dataStore type is Boolean. If true, flattenColor16 will return a DataStore object, otherwise it will return the raw b64-encoded data
    flattenColor16 : function(b64Data, screenWidth, screenHeight, dataStore) {
     return WacomGSS.STU.send
            ({
              "scope": "WacomGSS.STU.ProtocolHelper",
              "function": "flattenColor16",
              "b64Data": b64Data,
              "screenWidth": screenWidth,
              "screenHeight": screenHeight,
              "dataStore": (true === dataStore? true : false)
            })
            .then( function(message) {
              if('string' === typeof message) {
                return message;
              }
              var dataStore = new WacomGSS.STU.DataStore();
              dataStore.setId(message.id);
              return dataStore;
            });
    },
    // b64Data type is a base64-encoded image string, or a DataStore reference to it
    // screenWidth type is Integer
    // screenHeight type is Integer
    // dataStore type is Boolean. If true, flattenColor24 will return a DataStore object, otherwise it will return the raw b64-encoded data
    flattenColor24 : function(b64Data, screenWidth, screenHeight, dataStore) {
      return WacomGSS.STU.send
            ({
              "scope": "WacomGSS.STU.ProtocolHelper",
              "function": "flattenColor24",
              "b64Data": b64Data,
              "screenWidth": screenWidth,
              "screenHeight": screenHeight,
              "dataStore": (true === dataStore? true : false)
            })
            .then( function(message) {
              if('string' === typeof message) {
                return message;
              }
              var dataStore = new WacomGSS.STU.DataStore();
              dataStore.setId(message.id);
              return dataStore;
            });
    },
    // protocol type is WacomGSS.STU.Procotol
    // retries is an Integer
    // sleepBetweenRetries is an Integer (milliseconds)
    // timeout is an Integer (milliseconds)
    generateSymmetricKeyAndWaitForEncryptionStatus: function(protocol, retries, sleepBetweenRetries, timeout) {
      var opDirection = WacomGSS.STU.ProtocolHelper.OpDirection.OpDirection_Set;
      var deferred = Q.defer();
      var ticket2 = getTicket();
      table[ticket2] = deferred;

      return WacomGSS.STU.ProtocolHelper.waitForStatusToSend(protocol, 
                                                             WacomGSS.STU.Protocol.ReportId.ReportId_EncryptionCommand, 
                                                             opDirection, 
                                                             retries, 
                                                             sleepBetweenRetries)
             .then( function(message) {
             return WacomGSS.STU.send
                          ({
                            "scope": "WacomGSS.STU.ProtocolHelper", 
                            "function": "generateSymmetricKeyAndWaitForEncryptionStatus",
                            "protocol": protocol.toJSON(),
                            "intf": protocol.getInterface().toJSON(),
                            "timeout": timeout,
                            "sleepBetweenRetries": sleepBetweenRetries,
                            "ticket2": ticket2
                          })
                          .then(function(message) {
                            return deferred.promise;
                          });
             });
    },
    // idProduct type is Integer
    // encodingFlag type is Integer
    simulateEncodingFlag: function(idProduct, encodingFlag) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.ProtocolHelper",
               "function": "simulateEncodingFlag",
               "idProduct": idProduct,
               "encodingFlag": ('undefined' === typeof obj? 0 : encodingFlag)
             })
    },
    // protocol type is WacomGSS.STU.Procotol
    // encodingMode type is Protocol.EncodingMode
    // area type is Protocol.Rectangle
    // imageData type is a base64-encoded image string, or a DataStore reference to it
    // retries is an Integer
    // sleepBetweenRetries is an Integer (milliseconds)
    writeImageArea : function(protocol, encodingMode, area, imageData, retries, sleepBetweenRetries) {
      retries = (typeof retries === 'undefined')? 25 : retries;
      sleepBetweenRetries = (typeof sleepBetweenRetries === 'undefined')? 25 : sleepBetweenRetries;
      var opDirection = WacomGSS.STU.ProtocolHelper.OpDirection.OpDirection_Set;
      return WacomGSS.STU.ProtocolHelper.waitForStatusToSend(protocol, 
                                                             WacomGSS.STU.Protocol.ReportId.ReportId_StartImageDataArea, 
                                                             opDirection, 
                                                             retries, 
                                                             sleepBetweenRetries)
             .then( function(message){
               return protocol.setStartImageDataArea(encodingMode, area);
             })
             .then( function(message){
               var maxImageBlockSize = protocol.ImageDataBlock_maxLengthHID;
               return WacomGSS.STU.ProtocolHelper.writeImageCommon(protocol, 
                                                                   encodingMode, 
                                                                   maxImageBlockSize, 
                                                                   imageData, 
                                                                   retries, 
                                                                   sleepBetweenRetries);
             });
    },
    // protocol type is WacomGSS.STU.Procotol
    // encodingMode type is Protocol.EncodingMode
    // imageData type is a base64-encoded image string, or a DataStore reference to it
    // retries is an Integer
    // sleepBetweenRetries is an Integer (milliseconds)
    writeRomImage: function (protocol, romStartImageData, maxImageBlockSize, imageData, retries, sleepBetweenRetries) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.ProtocolHelper",
               "function": "writeRomImage",
               "protocol": protocol, 
               "romStartImageData": romStartImageData, 
               "maxImageBlockSize": maxImageBlockSize, 
               "imageData": imageData, 
               "retries": retries, 
               "sleepBetweenRetries": sleepBetweenRetries
             })
    },
  }
  
  STU.prototype.Tablet = (function() {
    var scope = "WacomGSS.STU.Tablet";
    var id = null;
  
    function Tablet() {
    }
 
    Tablet.prototype.toJSON = function() {
      return {"id": id, "scope": scope};
    }
    // intf can be a UsbInterface, SerialInterface
    // encryptionHandler is a WacomGSS.STU.EncryptionHandler. 
    // encryptionHandler2 is a WacomGSS.STU.EncryptionHandler2.
    Tablet.prototype.Constructor = function(intf, encryptionHandler, encryptionHandler2) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "function": "Constructor", 
               "hasIntf": ('undefined' !== typeof intf),
               "intf": ('undefined' === typeof intf)? null : intf.toJSON(),
               "encryptionHandler": ('undefined' === typeof encryptionHandler || null === encryptionHandler)? null : encryptionHandler.toJSON(),
               "encryptionHandler2": ('undefined' === typeof encryptionHandler2 || null === encryptionHandler2)? null : encryptionHandler2.toJSON()
             })
             .then( function(message) {
               id = message.id;
               return message;
             });
    }
    // intf  can be a UsbInterface, SerialInterface
    Tablet.prototype.attach = function(intf) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "attach",
               "intf": ('undefined' === typeof intf)? null : intf.toJSON()
             });
    }
 
    Tablet.prototype.detach = function(intf) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "detach"
             })
             .then( function (message) {
               var ret;
               if(checkExists(message.scope) && checkExists(message.id)) {
                 if("WacomGSS.STU.UsbInterface" === message.scope) {
                   ret = new STU.UsbInterface;
                    ret.id = message.id;
                 } 
                 else if ("WacomGSS.STU.SerialInterface" === message.scope) {
                   ret = new STU.SerialInterface;
                   ret.id = message.id;
                 }
               }
               return ret;
             });
    }
 
    Tablet.prototype.getInformation = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getInformation"
             });
    }
 
    Tablet.prototype.setClearScreen = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setClearScreen"
             });
    }
    // reportId type is Protocol.ReportId
    Tablet.prototype.isSupported = function(reportId) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "isSupported",
               "reportId": reportId
             });
    }
 
    Tablet.prototype.getProductId = function(reportId) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getProductId"
             });
    }
    // penDataOptionMode type is Protocol.PenDataOptionMode
    Tablet.prototype.setPenDataOptionMode = function(penDataOptionMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setPenDataOptionMode",
               "penDataOptionMode": penDataOptionMode
             });
    }
 
    Tablet.prototype.getDHprime = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getDHprime"
             });
    }
    // sessionId is an integer
    Tablet.prototype.startCapture = function(sessionId) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "startCapture",
               "sessionId": sessionId
             });
    }
    // inkingMode is an Protocol.InkingMode
    Tablet.prototype.setInkingMode = function(inkingMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setInkingMode",
               "inkingMode": inkingMode
             });
    }
    // predicate is a Boolean
    Tablet.prototype.queueSetPredicateAll = function(predicate) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "queueSetPredicateAll",
               "predicate": predicate
             });
    }
 
    Tablet.prototype.endCapture = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "endCapture"
             });
    }
 
    Tablet.prototype.disconnect = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "disconnect"
             });
    }
 
    Tablet.prototype.empty = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "empty"
             });
    }
 
    Tablet.prototype.isConnected = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "isConnected"
             });
    }
 
    Tablet.prototype.supportsWrite = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "supportsWrite"
             });
    }
 
    Tablet.prototype.getReportCountLengths = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getReportCountLengths"
             });
    }
 
    Tablet.prototype.getStatus = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getStatus"
             });
    }
 
    Tablet.prototype.reset = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "reset"
             });
    }
 
    Tablet.prototype.getHidInformation = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHidInformation"
             });
    }
 
    Tablet.prototype.getCapability = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getCapability"
             });
    }
 
    Tablet.prototype.getUid = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getUid"
             });
    }
    // uid is an integer
    Tablet.prototype.setUid = function(uid) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setUid",
               "uid": uid
             });
    }
 
    Tablet.prototype.getUid2 = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getUid2"
             });
    }
    // defaultMode type is Protocol.DefaultMode 
    Tablet.prototype.setDefaultMode = function(defaultMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setDefaultMode",
               "defaultMode": defaultMode
             });
    }
 
    Tablet.prototype.getDefaultMode = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getDefaultMode"
             });
    }
 
    Tablet.prototype.getHostPublicKey = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHostPublicKey"
             });
    }
 
    Tablet.prototype.getDevicePublicKey = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getDevicePublicKey"
             });
    }
    // prime is an integer Array [16]
    Tablet.prototype.setDHprime = function(prime) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setDHprime",
               "prime": prime
             });
    }
 
    Tablet.prototype.getDHbase = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getDHbase"
             });
    }
    // base is an integer Array [2]
    Tablet.prototype.setDHbase = function(prime) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setDHbase",
               "base": base
             });
    }
    // area is a Protocol.Rectangle
    Tablet.prototype.setClearScreenArea = function(area) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setClearScreenArea",
               "area": area
             });
    }
 
    Tablet.prototype.getInkingMode = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getInkingMode"
             });
    }
 
    Tablet.prototype.getInkThreshold = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getInkThreshold"
             });
    }
    // inkThreshold type is Protocol.InkThreshold
    Tablet.prototype.setInkThreshold = function(inkThreshold) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setInkThreshold",
               "inkThreshold": inkThreshold
             });
    }
    // encodingMode type is Protocol.EncodingMode
    // b64data type is a base64-encoded image string, or a DataStore reference to it
    Tablet.prototype.writeImage = function(encodingMode, b64Data) {
      var data = null;
      if ('string' === typeof b64Data) {
        data = b64Data;
      } else {
        data = b64Data.toJSON();
      }
      return WacomGSS.STU.send
             ({
              "scope": scope, 
              "id": id, 
              "function": "writeImage",
              "encodingMode": encodingMode,
              "b64Data": data
            });
    }
    // encodingMode type is Protocol.EncodingMode
    // area type is Protocol.Rectangle
    // b64data type is a base64-encoded image string, or a DataStore reference to it
    Tablet.prototype.writeImageArea = function(encodingMode, area, b64Data) {
      var data = null;
      if ('string' === typeof b64Data) {
        data = b64Data;
      } else {
        data = b64Data.toJSON();
      }
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "writeImageArea",
               "encodingMode": encodingMode,
               "area": area,
               "b64Data": data
             });
    }
    // endImageDataFlag type is Protocol.EndImageDataFlag
    Tablet.prototype.endImageData = function(endImageDataFlag) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "endImageData"
             });
    }
    
    Tablet.prototype.getHandwritingThicknessColor = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHandwritingThicknessColor"
             });
    }
    // handwritingThicknessColor type is Protocol.HandwritingThicknessColor
    Tablet.prototype.setHandwritingThicknessColor = function(handwritingThicknessColor) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setHandwritingThicknessColor",
               "handwritingThicknessColor" : handwritingThicknessColor
             });
    }
    
    Tablet.prototype.getHandwritingThicknessColor24 = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHandwritingThicknessColor24"
             });
    }
    // handwritingThicknessColor24 type is Protocol.HandwritingThicknessColor24
    Tablet.prototype.setHandwritingThicknessColor24 = function(handwritingThicknessColor24) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setHandwritingThicknessColor24",
               "handwritingThicknessColor24": handwritingThicknessColor24
             });
    }
 
    Tablet.prototype.getBackgroundColor = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getBackgroundColor"
             });
    }
    // backgroundColor type is Integer
    Tablet.prototype.setBackgroundColor = function(backgroundColor) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setBackgroundColor",
               "backgroundColor" : backgroundColor
             });
    }
    
    Tablet.prototype.getBackgroundColor24 = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getBackgroundColor24"
             });
    }
    // backgroundColor24 type is Integer
    Tablet.prototype.setBackgroundColor24 = function(backgroundColor24) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setBackgroundColor24",
               "backgroundColor24" : backgroundColor24
             });
    }
    
    Tablet.prototype.getHandwritingDisplayArea = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getHandwritingDisplayArea"
             });
    }
    // handwritingDisplayArea type is Protocol.Rectangle
    Tablet.prototype.setHandwritingDisplayArea = function(handwritingDisplayArea) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setHandwritingDisplayArea",
               "handwritingDisplayArea" : handwritingDisplayArea
             });
    }
 
    Tablet.prototype.getBacklightBrightness = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getBacklightBrightness"
             });
    }
    // backlightBrightness type is Integer
    Tablet.prototype.setBacklightBrightness = function(backlightBrightness) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setBacklightBrightness",
               "backlightBrightness" : backlightBrightness
             });
    }
    
    Tablet.prototype.getScreenContrast = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getScreenContrast"
             });
    }
    // screenContrast type is Integer
    Tablet.prototype.setScreenContrast = function(screenContrast) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setScreenContrast",
               "screenContrast" : screenContrast
             });
    }
 
    Tablet.prototype.getPenDataOptionMode = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getPenDataOptionMode"
             });
    }
    
    Tablet.prototype.getEncryptionStatus = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getEncryptionStatus"
             });
    }
    // encryptionCommandNumber type is Protocol.EncryptionCommandNumber
    Tablet.prototype.getEncryptionCommand = function(encryptionCommandNumber) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "getEncryptionCommand",
               "encryptionCommandNumber": encryptionCommandNumber
             });
    }
    // data type is Integer Array[16] (16-byte block of data to decrypt)
    Tablet.prototype.decrypt = function(data) {
      return WacomGSS.STU.send // return the decrypted 16-byte array
             ({
               "scope": scope, 
               "id": id, 
               "decrypt": "decrypt",
               "data": data
             });
    }
    // reportRate is an integer
    Tablet.prototype.setReportRate = function(reportRate) {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "setReportRate",
               "reportRate": reportRate
             });
    }
 
    Tablet.prototype.getReportRate = function() {
      return WacomGSS.STU.send
             ({
         "scope": scope, 
         "id": id, 
         "function": "getReportRate"
       });
    }
    
    // renderingMode is Protocol.RenderingMode
    Tablet.prototype.setRenderingMode = function (renderingMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setRenderingMode",
               "renderingMode": renderingMode
             });
    }

    Tablet.prototype.getRenderingMode = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getRenderingMode"
             });
    }

    // operationMode is Protocol.OperationMode_Normal, _PinPad, _SlideShow, _KeyPad or _Signature
    Tablet.prototype.setOperationMode = function (operationMode) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setOperationMode",
               "operationMode": operationMode
             });
    }

    Tablet.prototype.getOperationMode = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getOperationMode"
             });
    }

    // romStartImage type is Protocol.RomStartImageData_PinPad, _SlideShow, _KeyPad, _Signature or _MessageBox
    Tablet.prototype.writeRomImage = function (romStartImageData, imageData) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "writeRomImage",
               "romStartImageData": romStartImageData, 
               "imageData": imageData, 
    });
    }

    Tablet.prototype.setRomImageHash = function (operationModeType, imageType, imageNumber) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setRomImageHash",
               "operationModeType": operationModeType,
               "imageType": imageType,
               "imageNumber": imageNumber
             });
    }

    Tablet.prototype.getRomImageHash = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getRomImageHash"
             });
    }

    // romImageDeleteMode is Protocol.RomImageDeleteMode value
    // imageType    false=not pushed; true=pushed
    // imageNumber  1..10 depending on delete mode
    Tablet.prototype.setRomImageDelete = function (romImageDeleteMode, imageType, imageNumber) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setRomImageDelete",
               "romImageDeleteMode": romImageDeleteMode,
               "imageType": imageType,
               "imageNumber": imageNumber
             });
    }

    Tablet.prototype.getCurrentImageArea = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getCurrentImageArea"
             });
    }

    // operationModeType is Protocol.OperationModeType value
    // imageType    false=not pushed; true=pushed
    // imageNumber  1..10 depending on operation mode
    Tablet.prototype.setRomImageDisplay = function (operationModeType, imageType, imageNumber) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setRomImageDisplay",
               "operationModeType": operationModeType,
               "imageType": imageType,
               "imageNumber": imageNumber
             });
    }

    Tablet.prototype.getEserial = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getEserial"
             });
    }


    return Tablet;
  })();
  
  
  STU.prototype.SerialInterface = (function() {
    
    var scope = "WacomGSS.STU.SerialInterface";
    var id = "";
    // Constructor
    function SerialInterface() {
    }
    
    SerialInterface.prototype.Constructor = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "function": "Constructor"
             })
             .then( function(message) {
               id = message.id;
               return message;
             });
    }
    SerialInterface.prototype.BaudRate_STU500 = 115200;
    SerialInterface.prototype.BaudRate_STU430_530_prerelease = 460800;
    SerialInterface.prototype.BaudRate_STU430_530 = 3000000;
    // fileName is a string
    // baudRate is an int
    // useCrc is a Boolean
    SerialInterface.prototype.connect = function(fileName, baudRate, useCrc) {
      return WacomGSS.STU.send
          ({
            "scope": scope, 
            "id": id, 
            "function": "connect", 
            "fileName": fileName, 
            "baudRate": baudRate,
            "useCrc": useCrc
          });
    }
    
    SerialInterface.prototype.toJSON = function() {
      return {"id": id, "scope": scope};
    }
    
    SerialInterface.prototype.disconnect = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "id": id, 
               "function": "disconnect"
             });
    }
    
    SerialInterface.prototype.isConnected = function() {
      return WacomGSS.STU.send
          ({
            "scope": scope, 
            "id": id, 
            "function": "isConnected"
          });
    }
    
    SerialInterface.prototype.queueNotifyAll = function() {
      return WacomGSS.STU.send
          ({
            "scope": scope, 
            "id": id, 
            "function": "queueNotifyAll"
          });
    }
    // predicate type is Boolean
    SerialInterface.prototype.queueSetPredicateAll = function(predicate) {
      return WacomGSS.STU.send
          ({
            "scope": scope, 
            "id": id, 
            "function": "queueSetPredicateAll",
            "predicate": predicate
          });
    }
    // length type is an integer
    SerialInterface.prototype.get = function(length) {
      return WacomGSS.STU.send // returns a Base64-encoded string
          ({
            "scope": scope, 
            "id": id, 
            "function": "get_", // the '_' is deliberate
            "length": length
          });
    }
    // base64Data is a base64-encoded image string, or a DataStore reference to it
    SerialInterface.prototype.set = function(base64Data) {
      return WacomGSS.STU.send 
          ({
            "scope": scope, 
            "id": id, 
            "function": "set", 
            "base64Data": base64Data
          });
    }
    
    SerialInterface.prototype.supportsWrite = function() {
      return WacomGSS.STU.send
          ({
            "scope": scope, 
            "id": id, 
            "function": "supportsWrite"
          });
    }
    // base64Data is a base64-encoded image string, or a DataStore reference to it
    SerialInterface.prototype.write = function(base64Data) {
      return WacomGSS.STU.send 
          ({
            "scope": scope, 
            "id": id, 
            "function": "write", 
            "base64Data": base64Data
          });
    }
 
    SerialInterface.prototype.getReportCountLengths = function() {
      return WacomGSS.STU.send
          ({
            "scope": scope, 
            "id": id, 
            "function": "getReportCountLengths"
          });
    }
    
    SerialInterface.prototype.getProductId = function() {
      return WacomGSS.STU.send
          ({
            "scope": scope, 
            "id": id, 
            "function": "getProductId"
          });
    }
    
    return SerialInterface;
  })();
  
  STU.prototype.TlsInterface = (function () {

    var scope = "WacomGSS.STU.TlsInterface";
    var id = "";
    // Constructor
    function TlsInterface() {
    }

    TlsInterface.prototype.Constructor = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "function": "Constructor"
             })
             .then(function (message) {
               id = message.id;
               return message;
             });
    }

    TlsInterface.prototype.ConnectOption =
    {
      ConnectOption_OOB: 0x1,
      ConnectOption_SSL: 0x2
    };

    // fileName is a string
    // connectOption is ConnectOption
    TlsInterface.prototype.connect = function (fileName, connectOption) {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "connect",
            "fileName": fileName,
            "connectOption": connectOption
          });
    }

    TlsInterface.prototype.toJSON = function () {
      return { "id": id, "scope": scope };
    }

    TlsInterface.prototype.disconnect = function () {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "disconnect"
             });
    }

    TlsInterface.prototype.isConnected = function () {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "isConnected"
          });
    }

    // length type is an integer
    TlsInterface.prototype.get = function (length) {
      return WacomGSS.STU.send // returns a Base64-encoded string
          ({
            "scope": scope,
            "id": id,
            "function": "get_", // the '_' is deliberate
            "length": length
          });
    }
    // base64Data is a base64-encoded image string, or a DataStore reference to it
    TlsInterface.prototype.set = function (base64Data) {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "set",
            "base64Data": base64Data
          });
    }

    TlsInterface.prototype.supportsWrite = function () {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "supportsWrite"
          });
    }
    // base64Data is a base64-encoded image string, or a DataStore reference to it
    TlsInterface.prototype.write = function (base64Data) {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "write",
            "base64Data": base64Data
          });
    }

    TlsInterface.prototype.getReportCountLengths = function () {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "getReportCountLengths"
          });
    }

    TlsInterface.prototype.getProductId = function () {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "getProductId"
          });
    }

    /*
    TlsInterface.prototype.getPeerCertificate = function () {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "getPeerCertificate"
          });
    }

    TlsInterface.prototype.isConnectedOOB = function () {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "isConnectedOOB"
          });
    }

    TlsInterface.prototype.setOOB = function (base64Data) {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "setOOB",
            "base64Data": base64Data
          });
    }

    TlsInterface.prototype.getOOB = function () {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "getOOB",
          });
    }

    TlsInterface.prototype.send = function (base64Data) {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "send",
            "base64Data": base64Data,
          });
    }

    // Report 
    TlsInterface.prototype.send2 = function (base64Data) {
      return WacomGSS.STU.send
          ({
            "scope": scope,
            "id": id,
            "function": "send2",
            "base64Data": base64Data
          });
    }
    */
    return TlsInterface;
  })();

  
  STU.prototype.DataStore = (function() {
    var scope = "WacomGSS.STU.DataStore";
    var id = null;
 
    function DataStore() {
    }
 
    DataStore.prototype.setId = function(_id) {
      id = _id;
    }
 
    DataStore.prototype.toJSON = function() {
      return {"id": id, "scope": scope};
    }
    // b64Data is a base64-encoded string
    DataStore.prototype.Constructor = function(b64Data) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "function": "Constructor",
               "b64Data": b64Data
             });
    }
 
    DataStore.prototype.getData = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getData"
             });
    }
    
    DataStore.prototype.getRemove = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "getRemove"
             })
             .then( function(message) {
               id = null;
               return message;
             });
    }
 
    DataStore.prototype.remove = function() {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "remove"
             })
             .then( function(message) {
               id = null;
               return message;
             });
    }
 
    // b64Data is a base64-encoded string
    DataStore.prototype.setData = function(b64Data) {
      return WacomGSS.STU.send
             ({
               "scope": scope,
               "id": id,
               "function": "setData",
               "b64Data": b64Data
             });
    }
 
    return DataStore;
  })();
  
  STU.prototype.SerialProtocol = 
  {
    getHeaderLength : function() {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
              "function": "getHeaderLength"
             });
    },
    // _byte is an Integer (a byte)
    isStartReport : function(_byte) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
               "function": "isStartReport",
               "byte": _byte
             });
    },
    // header1 is an Integer (a byte)
    decodeHasCrc : function(header1) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
               "function": "decodeHasCrc",
               "header1": header1
             });
    },
    // header1 is an Integer (a byte)
    // header2 is an Integer (a byte)
    decodeEncodedDataLength : function(header1, header2) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
               "function": "decodeEncodedDataLength",
               "header1": header1,
               "header2": header2
             });
    },
    /*maxEncodedDataLength : function() {
      return WacomGSS.STU.send
          ({
         "scope": "WacomGSS.STU.SerialProtocol", 
        "function": "maxEncodedDataLength"
          });
    },*/
    // useCrc is a Boolean
    // length is an Integer
    calcEncodedDataLength : function(useCrc, length) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
               "function": "calcEncodedDataLength",
               "useCrc": useCrc,
               "length": length
             });
    },
    // encodedData is an Integer array
    // useCrc is a Boolean
    // encodedDataLength is an Integer
    encodeHeader : function(encodedData, useCrc, encodedDataLength) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
               "function": "encodeHeader",
               "encodedData": encodedData,
               "useCrc": useCrc,
               "encodedDataLength": encodedDataLength
             });
    },
    // report is an Integer array
    // useCrc is a Boolean
    encodeReport : function(report, useCrc) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
               "function": "encodeReport",
               "report": report,
               "useCrc": useCrc
             });
    },
    // data is an Integer array
    decodeData : function(data) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
               "function": "decodeData",
               "data": data
             });
    },
    // container is an Integer array
    checkCrcAndRemove : function(container) {
      return WacomGSS.STU.send
             ({
               "scope": "WacomGSS.STU.SerialProtocol", 
               "function": "checkCrcAndRemove",
               "container": container
             });
    }
  }
  
  STU.prototype.EncryptionHandler = (function() {
    var scope = "WacomGSS.STU.EncryptionHandler";
    var streamId = null; 
    var id = null; 
    var m_impl = null;
    var details = new Object();
  
    function EncryptionHandler(_impl) {
      m_impl = _impl;
      this.stream = function(message) {
        try {
          details[message.function](message);
        } catch (error) {
          throw new Error("EncryptionHandler." + message.function + " : " + error + "\nmessage was:\n" + JSON.stringify(message));
        }
      }
    }
 
    EncryptionHandler.prototype.Constructor = function() {
      streamId = WacomGSS.STU.setStream(this);
         return WacomGSS.STU.send
                ({
                  "scope": scope, 
                  "function": "Constructor", 
                  "streamId": streamId
                })
               .then( function(message) {
                 id = message.id;
                 return message;
               });
    }
    
    EncryptionHandler.prototype.toJSON = function() {
      return {"id": id, "scope": scope};
    }
 
    details.reset = function(message) {
      m_impl.reset();
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": null
      });
    }
 
    details.clearKeys = function(message) {
      m_impl.clearKeys();
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
         "function": "set_value",
         "promiseId": message.promiseId,
         "data": null
      });
    }
 
    details.requireDH = function(message) {
      var requireDH = m_impl.requireDH();
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": requireDH
      });
    }
 
    details.setDH = function(message) {
      m_impl.setDH(message.data.dhPrime, message.data.dhBase);
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": null
      });
    }
 
    details.generateHostPublicKey = function(message) {
      var generateHostPublicKey = m_impl.generateHostPublicKey();
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": generateHostPublicKey
      });
    }
 
    details.computeSharedKey = function(message) {
      m_impl.computeSharedKey(message.data);
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": null
      });
    }
 
    details.decrypt = function(message) {
      var data = m_impl.decrypt(message.data);
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": data
      });
    }
 
    return EncryptionHandler;
  })();
  
  
  
  STU.prototype.EncryptionHandler2 = (function() {
    var scope = "WacomGSS.STU.EncryptionHandler2";
    var streamId = null; 
    var id = null; 
    var m_impl = null;
    var details = new Object();
     
    function EncryptionHandler2(_impl) {
      m_impl = _impl;
      this.stream = function(message) {        
        try {
          details[message.function](message);
        } catch (error) {
          throw new Error("EncryptionHandler2." + message.function + " : " + error + "\nmessage was:\n" + JSON.stringify(message));
        }
      }
    }
 
    EncryptionHandler2.prototype.Constructor = function() {
      streamId = WacomGSS.STU.setStream(this);
      return WacomGSS.STU.send
             ({
               "scope": scope, 
               "function": "Constructor", 
               "streamId": streamId
             })
             .then( function(message) {
               id = message.id;
               return message;
             });
    }
    
    EncryptionHandler2.prototype.toJSON = function() {
      return {"id": id, "scope": scope};
    }
 
    details.reset = function(message) {
      m_impl.reset();
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": null
      });
    }
 
    details.clearKeys = function(message) {
      m_impl.clearKeys();
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": null
      });
    }
 
    details.getParameters = function(message) {
      var tuple = m_impl.getParameters(message.data.symmetricKeyType, message.data.asymmetricPaddingType, message.data.asymmetricKeyType);
      var symmetricKeyType = tuple[0];
      var asymmetricPaddingType = tuple[1];
      var asymmetricKeyType = tuple[2];
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": 
               {
                 "symmetricKeyType" : symmetricKeyType,
                 "asymmetricPaddingType" : asymmetricPaddingType,
                 "asymmetricKeyType" : asymmetricKeyType
               }
      });
    }
 
    details.getPublicExponent = function(message) {
      var getPublicExponent = m_impl.getPublicExponent();
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": getPublicExponent
      });
    }
 
    details.generatePublicKey = function(message) {
      var generatePublicKey = m_impl.generatePublicKey();
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": generatePublicKey
      });
    }
 
    details.computeSessionKey = function(message) {
      m_impl.computeSessionKey(message.data);
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": null
      });
    }
 
    details.decrypt = function(message) {
      var data = m_impl.decrypt(message.data);
      WacomGSS.STU.sendNoReturn
      ({
        "scope": scope,
        "function": "set_value",
        "promiseId": message.promiseId,
        "data": data
      });
    }
 
    return EncryptionHandler2;
  })();
  
  return STU;
})();

WacomGSS.STU = new WacomGSS.STUConstructor();

