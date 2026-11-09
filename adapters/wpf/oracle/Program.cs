// M4A.2 executable oracle. Interprets programs over the public WeakEventManager<,> API and
// writes what happened. Programs carry no expected results: the frozen WPF and the CLR
// decide. Usage: dotnet Oracle.dll programs.json output.json
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;

const int StaHandlerStackBytes = 16 * 1024 * 1024;

var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, IncludeFields = true };
var programs = JsonSerializer.Deserialize<ProgramSpec[]>(File.ReadAllText(args[0]), options)!;
var results = new List<object>();

foreach (var program in programs)
{
    string[] log = [];
    // One thread per program: WeakEventTable is thread-static, so each program starts empty.
    var thread = new Thread(() =>
    {
        var interpreter = new Interpreter(program);
        interpreter.Run();
        log = interpreter.Snapshot();
        Dispatcher.CurrentDispatcher.InvokeShutdown();
    }, StaHandlerStackBytes);
    thread.SetApartmentState(ApartmentState.STA);
    thread.Start();
    thread.Join();
    results.Add(new { name = program.Name, log });
}

var assembly = typeof(WeakEventManager).Assembly;
var output = new
{
    runtime = new
    {
        windowsBase = assembly.Location,
        informationalVersion = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
        sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(assembly.Location))),
        clr = Environment.Version.ToString(),
        framework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
    },
    results,
};
File.WriteAllText(args[1], JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"{results.Count} programs; WindowsBase {output.runtime.informationalVersion}");

public sealed class ProgramSpec
{
    public string Name = "";
    public int Sources;
    public int Listeners;
    public Rule[] Rules = [];
    public Op[] Ops = [];
}

/// <summary>When handler H of listener L receives its delivery number When, run Ops inside the callback.</summary>
public sealed class Rule
{
    public int L;
    public int H;
    public int When;
    public Op[] Ops = [];
}

/// <summary>S is a source index, or -1 for the static event.</summary>
public sealed class Op
{
    public string Kind = "";
    public int S;
    public int L;
    public int H;
}

public sealed class Source(Interpreter interpreter, string name)
{
    private EventHandler<EventArgs>? _handlers;
    public string Name => name;

    public event EventHandler<EventArgs>? Fired
    {
        add { _handlers += value; interpreter.Log($"subscribe:{name}"); }
        remove { _handlers -= value; interpreter.Log($"unsubscribe:{name}"); }
    }

    public void Raise() => _handlers?.Invoke(this, EventArgs.Empty);
}

/// <summary>A static event, delivered with a null sender.</summary>
public sealed class StaticHost
{
    public static Interpreter? Current;
    private static EventHandler<EventArgs>? s_handlers;

    public static event EventHandler<EventArgs>? Fired
    {
        add { s_handlers += value; Current?.Log("subscribe:static"); }
        remove { s_handlers -= value; Current?.Log("unsubscribe:static"); }
    }

    public static void Raise() => s_handlers?.Invoke(null, EventArgs.Empty);
    public static void Reset() => s_handlers = null;
}

public sealed class Listener(Interpreter interpreter, int id)
{
    public void H0(object? sender, EventArgs e) => interpreter.Delivered(id, 0, sender);
    public void H1(object? sender, EventArgs e) => interpreter.Delivered(id, 1, sender);
    public void H2(object? sender, EventArgs e) => interpreter.Delivered(id, 2, sender);
}

public sealed class Interpreter
{
    private readonly ProgramSpec _program;
    private readonly List<string> _log = [];
    private readonly Source?[] _sources;
    private readonly Listener?[] _listeners;
    private readonly WeakReference[] _sourceProbes;
    private readonly WeakReference[] _listenerProbes;
    private readonly Dictionary<(int, int), int> _deliveries = [];

    public Interpreter(ProgramSpec program)
    {
        _program = program;
        _sources = new Source?[program.Sources];
        _listeners = new Listener?[program.Listeners];
        _sourceProbes = new WeakReference[program.Sources];
        _listenerProbes = new WeakReference[program.Listeners];
        StaticHost.Reset();
        StaticHost.Current = this;
        for (var i = 0; i < program.Sources; i++) CreateSource(i);
        for (var i = 0; i < program.Listeners; i++) CreateListener(i);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void CreateSource(int i)
    {
        _sources[i] = new Source(this, $"s{i}");
        _sourceProbes[i] = new WeakReference(_sources[i]);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void CreateListener(int i)
    {
        _listeners[i] = new Listener(this, i);
        _listenerProbes[i] = new WeakReference(_listeners[i]);
    }

    public void Log(string line) => _log.Add(line);

    public string[] Snapshot() => [.. _log];

    public void Run() => RunAll(_program.Ops);

    private void RunAll(Op[] ops)
    {
        foreach (var op in ops)
        {
            try
            {
                Execute(op);
            }
            catch (Exception e)
            {
                Log($"{op.Kind}!{e.GetType().Name}");
            }
        }
    }

    public void Delivered(int listener, int handler, object? sender)
    {
        Log($"deliver:l{listener}.h{handler}<{(sender as Source)?.Name ?? "static"}");
        var key = (listener, handler);
        var count = _deliveries.GetValueOrDefault(key);
        _deliveries[key] = count + 1;
        foreach (var rule in _program.Rules)
        {
            if (rule.L == listener && rule.H == handler && rule.When == count) RunAll(rule.Ops);
        }
    }

    // Each operation has its own frame, so no temporary outlives it into a collection.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Execute(Op op)
    {
        switch (op.Kind)
        {
            case "add": Add(op); break;
            case "remove": Remove(op); break;
            case "raise": Raise(op); break;
            case "dropListener": _listeners[op.L] = null; Log($"drop:l{op.L}"); break;
            case "dropSource": _sources[op.S] = null; Log($"drop:s{op.S}"); break;
            case "collect": Collect(); Log("collect"); break;
            case "probe": Probe(); break;
            case "pump": Pump(); break;
            case "forcePurge": ForcePurge(); break;
            default: throw new InvalidOperationException(op.Kind);
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Add(Op op)
    {
        Log($"add:l{op.L}.h{op.H}>{SourceName(op)}");
        var listener = _listeners[op.L];
        if (listener is null) { Log("skipped"); return; }
        var handler = HandlerOf(listener, op.H);
        if (op.S < 0)
        {
            WeakEventManager<StaticHost, EventArgs>.AddHandler(null!, nameof(StaticHost.Fired), handler);
            return;
        }
        var source = _sources[op.S];
        if (source is null) { Log("skipped"); return; }
        WeakEventManager<Source, EventArgs>.AddHandler(source, nameof(Source.Fired), handler);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Remove(Op op)
    {
        Log($"remove:l{op.L}.h{op.H}>{SourceName(op)}");
        var listener = _listeners[op.L];
        if (listener is null) { Log("skipped"); return; }
        var handler = HandlerOf(listener, op.H);
        if (op.S < 0)
        {
            WeakEventManager<StaticHost, EventArgs>.RemoveHandler(null!, nameof(StaticHost.Fired), handler);
            return;
        }
        var source = _sources[op.S];
        if (source is null) { Log("skipped"); return; }
        WeakEventManager<Source, EventArgs>.RemoveHandler(source, nameof(Source.Fired), handler);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Raise(Op op)
    {
        Log($"raise:{SourceName(op)}");
        if (op.S < 0) StaticHost.Raise();
        else _sources[op.S]?.Raise();
        Log($"raised:{SourceName(op)}");
    }

    private static string SourceName(Op op) => op.S < 0 ? "static" : $"s{op.S}";

    // A new delegate object each call, equal by value to the others for the same method.
    // Nothing here keeps it, so only WPF's own table can.
    private static EventHandler<EventArgs> HandlerOf(Listener listener, int h) => h switch
    {
        0 => listener.H0,
        1 => listener.H1,
        _ => listener.H2,
    };

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Collect()
    {
        for (var i = 0; i < 4; i++)
        {
            GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, blocking: true);
            GC.WaitForPendingFinalizers();
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Probe()
    {
        var sources = string.Join(",", _sourceProbes.Select((p, i) => $"s{i}={(p.IsAlive ? 1 : 0)}"));
        var listeners = string.Join(",", _listenerProbes.Select((p, i) => $"l{i}={(p.IsAlive ? 1 : 0)}"));
        Log($"alive:{sources};{listeners}");
    }

    /// <summary>Runs queued dispatcher work down to ApplicationIdle, which is below the cleanup's ContextIdle.</summary>
    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Pump()
    {
        Dispatcher.CurrentDispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle, CancellationToken.None, TimeSpan.FromSeconds(5));
        Log("pump");
    }

    /// <summary>The internal hook WPF keeps for leak detectors. The only non-public call here.</summary>
    [MethodImpl(MethodImplOptions.NoInlining)]
    private void ForcePurge()
    {
        var cleanup = typeof(WeakEventManager).GetMethod("Cleanup", BindingFlags.NonPublic | BindingFlags.Static)!;
        Log($"forcePurge={cleanup.Invoke(null, null)}");
    }
}
