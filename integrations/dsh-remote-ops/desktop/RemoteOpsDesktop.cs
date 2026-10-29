// User-session desktop worker. SSH only transports messages; it never owns the UI.
using System;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using FlaUI.UIA3;
using FlaUI.Core.AutomationElements;

class RemoteOpsDesktop {
    const int Protocol = 1;
    static JavaScriptSerializer Json { get { return new JavaScriptSerializer { MaxJsonLength = 8388608, RecursionLimit = 64 }; } }
    static readonly string Sid = WindowsIdentity.GetCurrent().User.Value;
    static readonly int Session = Process.GetCurrentProcess().SessionId;
    static readonly string WorkerId = Guid.NewGuid().ToString("N");
    static readonly object Gate = new object();
    static UIA3Automation Automation;
    static readonly Dictionary<string, Snapshot> Snapshots = new Dictionary<string, Snapshot>();
    static readonly Dictionary<string, Receipt> Receipts = new Dictionary<string, Receipt>();
    static int Clients;
    static DateTime LastUse = DateTime.UtcNow;
    static bool CaptureStuck;
    static Timer IdleTimer;
    static readonly string AccessToken=Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N");
    static string EndpointPath(int session){return Path.Combine(Path.GetDirectoryName(typeof(RemoteOpsDesktop).Assembly.Location),"endpoint-"+session+".json");}
    static string FailurePath(int session){return Path.Combine(Path.GetDirectoryName(typeof(RemoteOpsDesktop).Assembly.Location),"startup-failure-"+session+".json");}
    class Receipt { public string Body; public object Result; }
    class Snapshot { public DateTime At; public IntPtr Window; public RECT Rect; public uint LastInput; public Dictionary<string, AutomationElement> Elements = new Dictionary<string, AutomationElement>(); }
    class DesktopException : Exception { public string Code; public DesktopException(string code, string message) : base(message) { Code = code; } }
    static void Fail(string code, string text) { throw new DesktopException(code, text); }
    static string Text(IDictionary<string,object> a, string key, string fallback = "") { object v; return a.TryGetValue(key,out v) && v != null ? Convert.ToString(v) : fallback; }
    static int Number(IDictionary<string,object> a, string key, int fallback = 0) { int value; return Int32.TryParse(Text(a,key),out value) ? value : fallback; }
    static Dictionary<string,object> Obj(object value) { return value as Dictionary<string,object> ?? new Dictionary<string,object>(); }
    static string Hash(string value) { using(var hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-","").ToLowerInvariant(); }
    static string Pipe(int session) { return "remote-ops-desktop-" + Hash(Sid).Substring(0,16) + "-" + session + "-" + Hash(Path.GetDirectoryName(typeof(RemoteOpsDesktop).Assembly.Location)).Substring(0,12); }
    static void Write(object value) { using(var output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false))) { output.WriteLine(Json.Serialize(value)); output.Flush(); } }

    [MTAThread] static int Main(string[] args) {
        try {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
            if(args.Length==0 || args[0]=="probe") { Write(Probe()); return 0; }
            if(args[0]=="ensure") { int id=Int32.Parse(args[1]); Ensure(id,args.Length>2&&args[2]=="task"); Write(Json.DeserializeObject(File.ReadAllText(EndpointPath(id))));return 0; }
            if(args[0]=="serve") { Serve(args[1]); return 0; }
            Fail("DESKTOP_MODE_INVALID","Unknown worker mode");
        } catch(Exception error) {var failure=new {error=error.Message,code=error is DesktopException ? ((DesktopException)error).Code : "DESKTOP_RUNTIME_FAILED"};if(args.Length>0&&args[0]=="serve"){try{File.WriteAllText(FailurePath(Session),Json.Serialize(failure));}catch{}}Write(failure);return 1; }
        return 1;
    }
    static object Probe() {
        var sessions=new List<object>();IntPtr p;int count;
        if(WTSEnumerateSessions(IntPtr.Zero,0,1,out p,out count)) {
            try { for(int i=0;i<count;i++) { var s=(WTS_SESSION_INFO)Marshal.PtrToStructure(IntPtr.Add(p,i*Marshal.SizeOf(typeof(WTS_SESSION_INFO))),typeof(WTS_SESSION_INFO));
                string user=SessionText(s.SessionID,5),domain=SessionText(s.SessionID,7); if(user.Length==0)continue;
                string account=domain.Length>0?domain+"\\"+user:user;
                try { if(((SecurityIdentifier)new NTAccount(account).Translate(typeof(SecurityIdentifier))).Value!=Sid)continue; } catch {continue;}
                sessions.Add(new {sessionId=s.SessionID,user=account,state=s.State==0?"active":"disconnected",station=Marshal.PtrToStringUni(s.pWinStationName)});
            }} finally {WTSFreeMemory(p);}
        }
        return new {protocol=Protocol,workerId=WorkerId,sessionId=Session,user=WindowsIdentity.GetCurrent().Name,sid=Sid,os=Environment.OSVersion.VersionString,architecture=Environment.Is64BitOperatingSystem?"x64":"x86",sessions=sessions,interactive=Interactive(),runtime=".NET Framework / FlaUI UIA3"};
    }
    static string SessionText(int session,int type) { IntPtr p;int bytes;if(!WTSQuerySessionInformation(IntPtr.Zero,session,type,out p,out bytes))return "";try{return Marshal.PtrToStringUni(p)??"";}finally{WTSFreeMemory(p);} }
    static bool Interactive() {
        if(Session<=0)return false;
        IntPtr h=OpenInputDesktop(0,false,1);if(h==IntPtr.Zero)return false;
        try {var name=new StringBuilder(128);int needed;return GetUserObjectInformation(h,2,name,256,out needed)&&name.ToString()=="Default";}finally{CloseDesktop(h);}
    }
    static void RequireDesktop() { if(!Interactive())Fail("DESKTOP_NOT_INTERACTIVE","The selected user desktop is locked or unavailable. Unlock/reconnect it before continuing."); }
    static bool Alive(string pipe) { try { using(var p=new NamedPipeClientStream(".",pipe,PipeDirection.InOut)) {p.Connect(200);return true;} }catch{return false;} }
    static void Ensure(int session,bool forceTask=false) {
        if(session<=0)Fail("DESKTOP_SESSION_INVALID","Choose a logged-on interactive user session");
        var probe=Obj(Json.DeserializeObject(Json.Serialize(Probe())));var sessions=probe["sessions"] as object[];
        if(sessions==null || !sessions.Any(x=>Number(Obj(x),"sessionId")==session && Text(Obj(x),"state")=="active"))Fail("DESKTOP_SESSION_UNAVAILABLE","No active desktop for this SSH account and session ID");
        string pipe=Pipe(session);if(Alive(pipe))return;
        if(File.Exists(FailurePath(session)))File.Delete(FailurePath(session));
        string exe=Path.Combine(Path.GetDirectoryName(typeof(RemoteOpsDesktop).Assembly.Location),"RemoteOpsDesktopWorker.exe");
        if(Session==session&&!forceTask)Process.Start(new ProcessStartInfo(exe,"serve "+pipe){UseShellExecute=false,CreateNoWindow=true});
        else {
            // InteractiveToken, same account, exact session: never substitute a service/S4U token.
            dynamic scheduler=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));scheduler.Connect();dynamic folder=scheduler.GetFolder("\\");dynamic task=scheduler.NewTask(0);
            task.RegistrationInfo.Description="Remote Ops user desktop worker";task.Principal.UserId=Sid;task.Principal.LogonType=3;
            task.Settings.ExecutionTimeLimit="PT0S";task.Settings.DisallowStartIfOnBatteries=false;task.Settings.StopIfGoingOnBatteries=false;task.Settings.Hidden=true;
            dynamic action=task.Actions.Create(0);action.Path=exe;action.Arguments="serve "+pipe;action.WorkingDirectory=Path.GetDirectoryName(exe);
            string name="RemoteOps-Desktop-"+Hash(pipe).Substring(0,20);
            dynamic registered=folder.RegisterTaskDefinition(name,task,6,Sid,null,3,null);registered.RunEx(null,4,session,null);
            // Remove the completed bootstrap registration; it is not an auto-logon/startup task.
            for(int i=0;i<50&&!Alive(pipe)&&!File.Exists(FailurePath(session));i++)Thread.Sleep(100);
            try{folder.DeleteTask(name,0);}catch{}
        }
        for(int i=0;i<50;i++){if(File.Exists(FailurePath(session))){var failure=Obj(Json.DeserializeObject(File.ReadAllText(FailurePath(session))));Fail(Text(failure,"code"),Text(failure,"error"));}if(Alive(pipe))return;Thread.Sleep(100);}
        Fail("DESKTOP_WORKER_START_FAILED","Worker did not become reachable in the selected desktop");
    }
    static void Serve(string pipe) {
        RequireDesktop();Automation=new UIA3Automation();Automation.ConnectionTimeout=TimeSpan.FromSeconds(3);Automation.TransactionTimeout=TimeSpan.FromSeconds(3);
        StartForwardEndpoint(pipe);
        var security=new PipeSecurity();security.SetAccessRuleProtection(true,false);
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid,null),PipeAccessRights.FullControl,AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(Sid),PipeAccessRights.FullControl,AccessControlType.Allow));
        IdleTimer=new Timer(_=>{if(Clients==0&&DateTime.UtcNow-LastUse>TimeSpan.FromMinutes(2))Environment.Exit(0);},null,30000,30000);
        while(true) {
            var p=new NamedPipeServerStream(pipe,PipeDirection.InOut,8,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,65536,security);
            p.WaitForConnection();Interlocked.Increment(ref Clients);
            var thread=new Thread(()=>{try {using(p)using(var input=new StreamReader(p,new UTF8Encoding(false),false,65536,true))using(var output=new StreamWriter(p,new UTF8Encoding(false),65536,true){AutoFlush=true}) {
                string line;while((line=ReadLine(input,262144))!=null)output.WriteLine(Json.Serialize(Respond(line)));
            }}catch{}finally{Interlocked.Decrement(ref Clients);LastUse=DateTime.UtcNow;}});thread.IsBackground=true;thread.SetApartmentState(ApartmentState.MTA);thread.Start();
        }
    }
    static string ReadLine(StreamReader reader,int max){var s=new StringBuilder();int c;while((c=reader.Read())!=-1){if(c==10)return s.ToString();if(c!=13)s.Append((char)c);if(s.Length>max)Fail("DESKTOP_REQUEST_LIMIT","Request exceeds its size limit");}return s.Length==0?null:s.ToString();}
    static object Respond(string line){var req=Obj(Json.DeserializeObject(line));var received=DateTime.UtcNow;lock(Gate){LastUse=DateTime.UtcNow;try{if(DateTime.UtcNow-received>TimeSpan.FromSeconds(8))Fail("DESKTOP_BUSY","Queued request expired without dispatch");var a=Obj(req.ContainsKey("args")?req["args"]:null);return new{id=Text(req,"id"),ok=true,result=Dispatch(Text(req,"method"),a)};}catch(Exception error){return new{id=Text(req,"id"),ok=false,code=error is DesktopException?((DesktopException)error).Code:"DESKTOP_OPERATION_FAILED",error=error.Message};}}}
    static void StartForwardEndpoint(string pipe){
        var listener=new TcpListener(IPAddress.Loopback,0);listener.Start(8);
        string file=EndpointPath(Session);var security=new FileSecurity();security.SetAccessRuleProtection(true,false);security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(Sid),FileSystemRights.FullControl,AccessControlType.Allow));
        using(var stream=new FileStream(file,FileMode.Create,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.None,security))using(var writer=new StreamWriter(stream,new UTF8Encoding(false)))writer.Write(Json.Serialize(new{pipe=pipe,port=((IPEndPoint)listener.LocalEndpoint).Port,token=AccessToken,sessionId=Session,protocol=Protocol}));
        var accept=new Thread(()=>{while(true){var client=listener.AcceptTcpClient();if(Interlocked.Increment(ref Clients)>8){client.Close();Interlocked.Decrement(ref Clients);continue;}
            var thread=new Thread(()=>{try{using(client)using(var stream=client.GetStream())using(var reader=new StreamReader(stream,new UTF8Encoding(false),false,65536,true))using(var writer=new StreamWriter(stream,new UTF8Encoding(false),65536,true){AutoFlush=true}){
                stream.ReadTimeout=5000;var auth=Obj(Json.DeserializeObject(ReadLine(reader,4096)));var a=Obj(auth.ContainsKey("args")?auth["args"]:null);
                if(Text(auth,"method")!="authenticate"||Text(a,"token")!=AccessToken)return;
                writer.WriteLine(Json.Serialize(new{id=Text(auth,"id"),ok=true,result=new{authenticated=true}}));stream.ReadTimeout=Timeout.Infinite;
                string line;while((line=ReadLine(reader,262144))!=null)writer.WriteLine(Json.Serialize(Respond(line)));
            }}catch{}finally{Interlocked.Decrement(ref Clients);LastUse=DateTime.UtcNow;}});thread.IsBackground=true;thread.SetApartmentState(ApartmentState.MTA);thread.Start();
        }});accept.IsBackground=true;accept.Start();
    }
    static object Dispatch(string method,Dictionary<string,object> args) {
        if(method=="status")return Probe();RequireDesktop();
        if(method=="observe")return Observe(args);
        if(method!="launch"&&method!="act") {Fail("DESKTOP_ACTION_INVALID","Unknown desktop operation");}
        if(Text(args,"workerId",WorkerId)!=WorkerId)Fail("DESKTOP_WORKER_CHANGED","The worker restarted; observe before any further action");
        string key=Text(args,"requestId");if(key.Length==0||key.Length>180)Fail("DESKTOP_REQUEST_INVALID","A bounded request ID is required");
        string body=Json.Serialize(args);Receipt receipt;
        if(Receipts.TryGetValue(key,out receipt)){if(receipt.Body!=body)Fail("DESKTOP_REQUEST_CONFLICT","Request ID already used with other arguments");if(receipt.Result==null)Fail("DESKTOP_OUTCOME_UNKNOWN","An earlier effect may have happened; observe before deciding what to do");return receipt.Result;}
        if(Receipts.Count>=2000)Fail("DESKTOP_RECEIPT_LIMIT","Reconnect a fresh idle worker before issuing more actions");
        Receipts[key]=receipt=new Receipt{Body=body};
        receipt.Result=method=="launch"?Launch(args):Act(args);return receipt.Result;
    }
    static string Quote(string arg) { var s=new StringBuilder("\"");int backslashes=0;foreach(char c in arg){if(c=='\\'){backslashes++;continue;}if(c=='"')s.Append('\\',backslashes*2+1);else s.Append('\\',backslashes);s.Append(c);backslashes=0;}s.Append('\\',backslashes*2);return s.Append('"').ToString(); }
    static object Launch(Dictionary<string,object> args) {
        string path=Text(args,"path");if(!Path.IsPathRooted(path)||!path.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||!File.Exists(path))Fail("DESKTOP_APP_NOT_FOUND","Choose an existing absolute .exe path on the target");
        object[] values=args.ContainsKey("args")?args["args"] as object[]:new object[0];if(values==null||values.Any(v=>!(v is string)))Fail("DESKTOP_ARGUMENT_INVALID","args must be an array of strings");
        var start=new ProcessStartInfo(path,String.Join(" ",values.Select(v=>Quote((string)v)))){UseShellExecute=false,CreateNoWindow=false,WorkingDirectory=Text(args,"workingDirectory",Path.GetDirectoryName(path))};
        var p=Process.Start(start);return new {status="launched",pid=p.Id,sessionId=Session,verified=false};
    }
    static IntPtr Window(Dictionary<string,object> args) {
        long raw;IntPtr window=Int64.TryParse(Text(args,"windowId"),out raw)?new IntPtr(raw):IntPtr.Zero;int pid=Number(args,"pid");
        if(window==IntPtr.Zero){var fg=GetForegroundWindow();if(pid>0&&ProcessId(fg)==pid)window=fg;else EnumWindows((h,l)=>{if(IsWindowVisible(h)&&Title(h).Length>0&&(pid==0||ProcessId(h)==pid)&&InSession(h)){window=h;return false;}return true;},IntPtr.Zero);}
        if(window!=IntPtr.Zero)window=GetAncestor(window,2);
        if(window==IntPtr.Zero||!IsWindow(window)||!InSession(window))Fail("DESKTOP_WINDOW_NOT_FOUND","Select a current window in this user session");return window;
    }
    static bool InSession(IntPtr h) { try{return Process.GetProcessById(ProcessId(h)).SessionId==Session;}catch{return false;} }
    static int ProcessId(IntPtr h){uint id;GetWindowThreadProcessId(h,out id);return (int)id;}
    static string Title(IntPtr h){var s=new StringBuilder(1024);GetWindowText(h,s,s.Capacity);return s.ToString();}
    static object Observe(Dictionary<string,object> args) {
        var windows=new List<object>();EnumWindows((h,l)=>{if(IsWindowVisible(h)&&InSession(h)&&Title(h).Length>0)windows.Add(new {windowId=h.ToInt64().ToString(),title=Title(h),pid=ProcessId(h)});return windows.Count<80;},IntPtr.Zero);
        if(windows.Count==0||Text(args,"listOnly")=="True"||Text(args,"listOnly")=="true")return new {windows=windows,elements=new object[0],screenshot=(object)null,interactive=true};
        IntPtr hWnd=Window(args);RECT rect;GetWindowRect(hWnd,out rect);if(IsIconic(hWnd))Fail("DESKTOP_WINDOW_MINIMIZED","Restore this window to inspect its visible content");
        var snapshot=new Snapshot{Window=hWnd,Rect=rect,At=DateTime.UtcNow,LastInput=LastInput()};var elements=new List<object>();var masks=new List<Rectangle>();string id=Guid.NewGuid().ToString("N");
        var root=Automation.FromHandle(hWnd);var queue=new Queue<Tuple<AutomationElement,int>>();queue.Enqueue(Tuple.Create(root,0));
        while(queue.Count>0&&elements.Count<350&&DateTime.UtcNow-snapshot.At<TimeSpan.FromSeconds(6)){var item=queue.Dequeue();var e=item.Item1;try{
            string key="e"+(elements.Count+1);snapshot.Elements[key]=e;bool password=e.Properties.IsPassword.ValueOrDefault;var bounds=e.Properties.BoundingRectangle.ValueOrDefault;
            string value=null;if(!password&&e.Patterns.Value.IsSupported)value=e.Patterns.Value.Pattern.Value.ValueOrDefault;
            if(password)masks.Add(bounds);
            elements.Add(new { @ref=key,name=password?"Password":Limit(e.Properties.Name.ValueOrDefault,600),automationId=e.Properties.AutomationId.ValueOrDefault,controlType=e.Properties.ControlType.ValueOrDefault.ToString(),enabled=e.Properties.IsEnabled.ValueOrDefault,offscreen=e.Properties.IsOffscreen.ValueOrDefault,password=password,value=value==null?null:Limit(value,8000),bounds=new {x=bounds.X,y=bounds.Y,width=bounds.Width,height=bounds.Height},canInvoke=e.Patterns.Invoke.IsSupported,canSetValue=e.Patterns.Value.IsSupported,canSelect=e.Patterns.SelectionItem.IsSupported,canToggle=e.Patterns.Toggle.IsSupported});
            if(item.Item2<12)foreach(var child in e.FindAllChildren().Take(100))queue.Enqueue(Tuple.Create(child,item.Item2+1));
        }catch{}}
        foreach(var old in Snapshots.Where(x=>DateTime.UtcNow-x.Value.At>TimeSpan.FromSeconds(45)).Select(x=>x.Key).ToArray())Snapshots.Remove(old);
        while(Snapshots.Count>=16)Snapshots.Remove(Snapshots.OrderBy(x=>x.Value.At).First().Key);Snapshots[id]=snapshot;
        object image=null;string captureError=null;try{image=Capture(hWnd,rect,masks);}catch(Exception error){captureError=error.Message;}
        RECT after;GetWindowRect(hWnd,out after);if(!after.Equals(rect))Fail("DESKTOP_SNAPSHOT_STALE","Window moved while being observed; observe again");snapshot.At=DateTime.UtcNow;
        return new {workerId=WorkerId,sessionId=Session,snapshotId=id,windowId=hWnd.ToInt64().ToString(),pid=ProcessId(hWnd),title=Title(hWnd),bounds=new{x=rect.Left,y=rect.Top,width=rect.Right-rect.Left,height=rect.Bottom-rect.Top},windows=windows,elements=elements,truncated=queue.Count>0,observedAt=snapshot.At.ToString("o"),screenshot=image,captureError=captureError,interactive=true};
    }
    static string Limit(string value,int length){return value==null?"":value.Substring(0,Math.Min(length,value.Length));}
    static object Act(Dictionary<string,object> args) {
        Snapshot snap;if(!Snapshots.TryGetValue(Text(args,"snapshotId"),out snap)||DateTime.UtcNow-snap.At>TimeSpan.FromSeconds(45))Fail("DESKTOP_SNAPSHOT_STALE","Observe the current window again");
        if(!IsWindow(snap.Window)||!InSession(snap.Window))Fail("DESKTOP_WINDOW_NOT_FOUND","Window no longer exists in this session");
        var step=Obj(args.ContainsKey("step")?args["step"]:null);string action=Text(step,"action"),reference=Text(step,"ref");AutomationElement e=null;
        if(reference.Length>0&&!snap.Elements.TryGetValue(reference,out e))Fail("DESKTOP_ELEMENT_NOT_FOUND","Element reference is not in this snapshot");
        if(e!=null&&(!e.Properties.IsEnabled.ValueOrDefault||e.Properties.IsOffscreen.ValueOrDefault))Fail("DESKTOP_ELEMENT_UNAVAILABLE","Element is disabled or not visible; observe again");
        if(action=="fill") {if(e==null||!e.Patterns.Value.IsSupported)Fail("DESKTOP_PATTERN_UNAVAILABLE","This element does not expose Value; use a supported control or explicit keyboard input");e.Patterns.Value.Pattern.SetValue(Text(step,"text"));}
        else if(action=="click"&&e!=null&&e.Patterns.Invoke.IsSupported)e.Patterns.Invoke.Pattern.Invoke();
        else if(action=="select"&&e!=null&&e.Patterns.SelectionItem.IsSupported)e.Patterns.SelectionItem.Pattern.Select();
        else if(action=="toggle"&&e!=null&&e.Patterns.Toggle.IsSupported) {bool desired=Text(step,"checked")=="True"||Text(step,"checked")=="true";var pattern=e.Patterns.Toggle.Pattern;if((pattern.ToggleState.ValueOrDefault.ToString()=="On")!=desired)pattern.Toggle();}
        else if(action=="expect") {if(e==null)Fail("DESKTOP_ELEMENT_NOT_FOUND","Expected element is missing");string actual=e.Patterns.Value.IsSupported&&!e.Properties.IsPassword.ValueOrDefault?e.Patterns.Value.Pattern.Value.ValueOrDefault:e.Properties.Name.ValueOrDefault;if(actual!=Text(step,"text"))Fail("DESKTOP_EXPECT_FAILED","Current control value did not match the expected result");return new {status="completed",verified=true};}
        else if(action=="click"||action=="keys"||action=="text"||action=="scroll") {
            RECT current;GetWindowRect(snap.Window,out current);if(!current.Equals(snap.Rect)||DateTime.UtcNow-snap.At>TimeSpan.FromSeconds(8))Fail("DESKTOP_SNAPSHOT_STALE","Window moved or input snapshot expired; observe again");
            // Clicking the DSH preview is itself input on a local target. Global
            // last-input ticks therefore cannot distinguish a stale target.
            // Bound point actions by snapshot age, window geometry and foreground.
            SetForegroundWindow(snap.Window);Thread.Sleep(60);if(GetForegroundWindow()!=snap.Window)Fail("DESKTOP_FOCUS_CHANGED","Target could not obtain foreground focus; no input sent");
            if(e!=null)e.Focus();
            if(action=="click") {int x,y;if(e!=null){var b=e.Properties.BoundingRectangle.ValueOrDefault;x=b.Left+b.Width/2;y=b.Top+b.Height/2;}else{x=current.Left+Number(step,"x",-1);y=current.Top+Number(step,"y",-1);}if(x<current.Left||y<current.Top||x>=current.Right||y>=current.Bottom)Fail("DESKTOP_POINT_INVALID","Point is outside the observed window");SetCursorPos(x,y);var at=WindowFromPoint(new POINT{x=x,y=y});if(GetAncestor(at,2)!=snap.Window)Fail("DESKTOP_WINDOW_OCCLUDED","Another window covers the target point; no click sent");SendMouse(2,0);SendMouse(4,0);}
            else if(action=="keys")Keys(Text(step,"keys"));
            else if(action=="text")foreach(char c in Text(step,"text")){SendKey(0,c,4);SendKey(0,c,6);}
            else SendMouse(0x800,Number(step,"delta"));
        } else Fail("DESKTOP_PATTERN_UNAVAILABLE","Action or control pattern is unavailable");
        return new {status="completed",verified=false};
    }
    static uint LastInput(){var info=new LASTINPUTINFO{cbSize=(uint)Marshal.SizeOf(typeof(LASTINPUTINFO))};GetLastInputInfo(ref info);return info.dwTime;}
    static void Keys(string value){var map=new Dictionary<string,ushort>{{"CTRL",17},{"SHIFT",16},{"ALT",18},{"ENTER",13},{"TAB",9},{"ESC",27},{"BACKSPACE",8},{"DELETE",46},{"HOME",36},{"END",35},{"LEFT",37},{"UP",38},{"RIGHT",39},{"DOWN",40},{"SPACE",32}};var keys=new List<ushort>();foreach(var token in value.ToUpperInvariant().Split('+')){ushort key;if(!map.TryGetValue(token,out key)){if(token.Length==1&&Char.IsLetterOrDigit(token[0]))key=token[0];else Fail("DESKTOP_KEY_INVALID","Unsupported key chord");}keys.Add(key);}try{foreach(var key in keys)SendKey(key,0,0);}finally{foreach(var key in keys.AsEnumerable().Reverse())SendKey(key,0,2);}}
    static void SendKey(ushort key,int scan,uint flags){var input=new INPUT{type=1,U=new INPUTUNION{ki=new KEYBDINPUT{wVk=key,wScan=(ushort)scan,dwFlags=flags}}};if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)Fail("DESKTOP_INPUT_FAILED","Windows rejected keyboard input; check window privileges");}
    static void SendMouse(uint flags,int data){var input=new INPUT{type=0,U=new INPUTUNION{mi=new MOUSEINPUT{mouseData=(uint)data,dwFlags=flags}}};if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)Fail("DESKTOP_INPUT_FAILED","Windows rejected mouse input");}
    static object Capture(IntPtr hwnd,RECT rect,List<Rectangle> masks) {
        if(CaptureStuck)Fail("DESKTOP_CAPTURE_UNAVAILABLE","A previous capture timed out; reconnect a fresh idle worker");
        int width=rect.Right-rect.Left,height=rect.Bottom-rect.Top;if(width<1||height<1||width>10000||height>10000)Fail("DESKTOP_CAPTURE_UNAVAILABLE","Window dimensions are unavailable");
        var work=Task.Run<object>(()=>{var previous=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(hwnd));try{RECT captureRect;GetWindowRect(hwnd,out captureRect);int renderWidth=captureRect.Right-captureRect.Left,renderHeight=captureRect.Bottom-captureRect.Top;
            using(var bitmap=new Bitmap(renderWidth,renderHeight)){
                using(var graphics=Graphics.FromImage(bitmap)){var dc=graphics.GetHdc();bool ok;try{ok=PrintWindow(hwnd,dc,2);}finally{graphics.ReleaseHdc(dc);}if(!ok)Fail("DESKTOP_CAPTURE_UNAVAILABLE","This application does not support window capture");foreach(var mask in masks)graphics.FillRectangle(Brushes.Black,(mask.X-rect.Left)*(float)renderWidth/width,(mask.Y-rect.Top)*(float)renderHeight/height,mask.Width*(float)renderWidth/width,mask.Height*(float)renderHeight/height);}
                double scale=Math.Min(1.0,1600.0/Math.Max(renderWidth,renderHeight));using(var small=new Bitmap(bitmap,new Size((int)(renderWidth*scale),(int)(renderHeight*scale))))using(var bytes=new MemoryStream()){small.Save(bytes,ImageFormat.Jpeg);return new {data=Convert.ToBase64String(bytes.ToArray()),mimeType="image/jpeg",width=small.Width,height=small.Height,sourceWidth=width,sourceHeight=height};}
            }
        }finally{SetThreadDpiAwarenessContext(previous);}});
        if(!work.Wait(2500)){CaptureStuck=true;Fail("DESKTOP_CAPTURE_TIMEOUT","Window capture did not respond");}return work.Result;
    }
    [StructLayout(LayoutKind.Sequential)]struct WTS_SESSION_INFO{public int SessionID;public IntPtr pWinStationName;public int State;}
    [StructLayout(LayoutKind.Sequential)]struct RECT{public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)]struct POINT{public int x,y;}
    [StructLayout(LayoutKind.Sequential)]struct LASTINPUTINFO{public uint cbSize,dwTime;}
    [StructLayout(LayoutKind.Sequential)]struct INPUT{public uint type;public INPUTUNION U;}
    [StructLayout(LayoutKind.Explicit)]struct INPUTUNION{[FieldOffset(0)]public MOUSEINPUT mi;[FieldOffset(0)]public KEYBDINPUT ki;}
    [StructLayout(LayoutKind.Sequential)]struct MOUSEINPUT{public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr dwExtraInfo;}
    [StructLayout(LayoutKind.Sequential)]struct KEYBDINPUT{public ushort wVk,wScan;public uint dwFlags,time;public UIntPtr dwExtraInfo;}
    delegate bool EnumWindowProc(IntPtr hwnd,IntPtr param);
    [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
    [DllImport("user32.dll")]static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
    [DllImport("user32.dll")]static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern bool GetUserObjectInformation(IntPtr h,int index,StringBuilder value,int length,out int needed);
    [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode)]static extern bool WTSEnumerateSessions(IntPtr h,int reserved,int version,out IntPtr sessions,out int count);
    [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode)]static extern bool WTSQuerySessionInformation(IntPtr h,int session,int type,out IntPtr buffer,out int bytes);
    [DllImport("wtsapi32.dll")]static extern void WTSFreeMemory(IntPtr p);
    [DllImport("user32.dll")]static extern bool EnumWindows(EnumWindowProc callback,IntPtr param);
    [DllImport("user32.dll")]static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")]static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int count);
    [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out RECT rect);
    [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr h,uint flags);
    [DllImport("user32.dll")]static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("user32.dll")]static extern uint SendInput(uint count,INPUT[] inputs,int size);
    [DllImport("user32.dll")]static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
}
