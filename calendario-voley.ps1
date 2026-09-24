<#
.SYNOPSIS
    Genera el calendario de partidos de un club de voleibol gallego (todas sus categorías).

.DESCRIPTION
    Descarga los partidos de la "Agenda calendario" de https://volei.gal/competiciones/
    (plataforma iSquad de la Federación Galega de Voleibol), se queda solo con los equipos
    del club elegido y genera, en la carpeta "calendario":

      - <nombre>.ics   Calendario para Google Calendar, Outlook, iPhone o Android.
      - <nombre>.html  Página con los partidos (lista y vista mensual), imprimible.
      - <nombre>.xlsx  Hoja de Excel con los partidos.
      - equipos\*.ics  Un calendario por cada equipo del club (para entrenadores y familias).

    La primera vez pregunta cuál es el club y lo guarda en config.json.
    Solo incluye los partidos que publica la federación gallega: en ligas nacionales
    faltan los partidos contra equipos de fuera de Galicia.

.PARAMETER Club
    Club a usar en lugar del guardado en config.json. Admite el ID de iSquad
    (p. ej. 206572577), parte del nombre (p. ej. "pontevedra") o varios separados por comas.

.PARAMETER Temporada
    Temporada a descargar, p. ej. "2026-27". Por defecto, la temporada en curso
    (del 1 de agosto al 31 de julio). Si todavía no hay partidos del club en la
    temporada en curso, se usa la anterior.

.PARAMETER Desde
    Fecha inicial (aaaa-mm-dd), dentro de la temporada. Por defecto, el 1 de agosto.

.PARAMETER Hasta
    Fecha final (aaaa-mm-dd), dentro de la temporada. Por defecto, el 31 de julio.

.PARAMETER Salida
    Carpeta donde se guardan los archivos. Por defecto, "calendario" junto a este script.

.PARAMETER NombreBase
    Nombre de los archivos generados (sin extensión). Por defecto se forma con el club y la temporada.

.PARAMETER DuracionMinutos
    Duración de cada partido en el calendario. Por defecto 120 minutos (o lo que diga config.json).

.PARAMETER Historial
    Archivo de texto donde guardar la lista de partidos sin fecha de generación, para
    detectar cambios (lo usa la publicación automática en GitHub).

.PARAMETER CambiarClub
    Vuelve a preguntar el club y guarda la nueva elección.

.PARAMETER ListarClubs
    Muestra los clubs disponibles con su ID y termina.

.PARAMETER SinPreguntar
    No hace preguntas (para tareas programadas o GitHub Actions). Falla si no hay club configurado.

.PARAMETER SinEquipos
    No genera los calendarios por equipo.

.PARAMETER Abrir
    Abre la página HTML al terminar.

.EXAMPLE
    .\calendario-voley.ps1
    Genera el calendario del club guardado (la primera vez pregunta cuál es).

.EXAMPLE
    .\calendario-voley.ps1 -Temporada 2025-26
    Genera el calendario de la temporada anterior.
#>
#requires -Version 5.1
[CmdletBinding(PositionalBinding = $false)]
param(
    [string] $Club,
    [string] $Temporada,
    [string] $Desde,
    [string] $Hasta,
    [string] $Salida,
    [string] $NombreBase,
    [ValidateRange(0, 600)]
    [int]    $DuracionMinutos = 0,
    [string] $Historial,
    [switch] $CambiarClub,
    [switch] $ListarClubs,
    [switch] $SinPreguntar,
    [switch] $SinEquipos,
    [switch] $Abrir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # la barra de progreso hace muy lenta la descarga en PowerShell 5.1
try {
    # Con "SystemDefault" (Windows 10/11 al día) Windows ya elige TLS 1.2/1.3: no se toca. En equipos
    # antiguos se añaden TLS 1.2 y, si existe, TLS 1.3 (el servicio de rutas no acepta versiones viejas).
    $protocolos = [Net.ServicePointManager]::SecurityProtocol
    if ([int]$protocolos -ne 0) {
        $protocolos = $protocolos -bor [Net.SecurityProtocolType]::Tls12
        try { $protocolos = $protocolos -bor [Net.SecurityProtocolType]'Tls13' } catch { }
        [Net.ServicePointManager]::SecurityProtocol = $protocolos
    }
} catch { }

# --- Constantes --------------------------------------------------------------------------------

$Script:UrlBase     = 'https://resultadosvoleibol.isquad.es'
$Script:UrlFuente   = 'https://volei.gal/competiciones/'
$Script:Ambito      = '20'   # Federación Galega de Voleibol
$Script:Superficie  = '1'    # voleibol en pista (no playa)
$Script:ZonaHoraria = 'Europe/Madrid'
$Script:Inv         = [Globalization.CultureInfo]::InvariantCulture
$Script:Utf8        = New-Object Text.UTF8Encoding($false)
$Script:Carpeta     = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Script:RutaConfig  = Join-Path $Script:Carpeta 'config.json'

$Script:DiasCortos  = @('dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb')
$Script:Dias        = @('domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado')

# Orden y color de las categorías (de menor a mayor edad).
$Script:Categorias = @(
    @{ Clave = 'benjamin'; Patron = 'BENJAM' },
    @{ Clave = 'alevin';   Patron = 'ALEV' },
    @{ Clave = 'infantil'; Patron = 'INFANTIL' },
    @{ Clave = 'cadete';   Patron = 'CADETE' },
    @{ Clave = 'juvenil';  Patron = 'JUVENIL|XUVENIL' },
    @{ Clave = 'junior';   Patron = 'JUNIOR' },
    @{ Clave = 'senior';   Patron = 'SENIOR|SUPERLIGA|DIVISION|NACIONAL|LIGA' }
)

# --- Utilidades --------------------------------------------------------------------------------

function Write-Paso([string]$Texto) { Write-Host "  $Texto" -ForegroundColor Gray }
function Write-Aviso([string]$Texto) { Write-Host "  ! $Texto" -ForegroundColor Yellow }

function ConvertTo-TextoPlano([string]$Html) {
    # Quita las etiquetas HTML que iSquad mete en los campos; cada <br> pasa a ser un salto de línea.
    if ([string]::IsNullOrWhiteSpace($Html) -or $Html -eq 'None') { return '' }
    $t = $Html -replace '(?i)<\s*/?\s*br\s*/?\s*>', "`n"
    $t = $t -replace '<[^>]*>', ' '
    $t = [Net.WebUtility]::HtmlDecode($t)
    $lineas = foreach ($l in ($t -split "`n")) {
        $l = ($l -replace '\s+', ' ').Trim()
        if ($l) { $l }
    }
    return (@($lineas) -join "`n")
}

function ConvertTo-UnaLinea([string]$Html) { return ((ConvertTo-TextoPlano $Html) -replace "`n", ' ') }

function Get-SinTildes([string]$Texto) {
    if (-not $Texto) { return '' }
    $n = $Texto.Normalize([Text.NormalizationForm]::FormD)
    $sb = New-Object Text.StringBuilder
    foreach ($c in $n.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$sb.Append($c)
        }
    }
    return $sb.ToString().Normalize([Text.NormalizationForm]::FormC)
}

function Get-Clave([string]$Texto) { return ((Get-SinTildes $Texto).ToUpperInvariant() -creplace '[^A-Z0-9]+', ' ').Trim() }

function Get-Slug([string]$Texto) {
    $s = ((Get-SinTildes $Texto).ToLowerInvariant() -creplace '[^a-z0-9]+', '-').Trim('-')
    if ($s.Length -gt 60) { $s = $s.Substring(0, 60).Trim('-') }
    if (-not $s) { $s = 'calendario' }
    return $s
}

function Get-Hash([string]$Texto) {
    $sha = [Security.Cryptography.SHA1]::Create()
    try {
        $bytes = $sha.ComputeHash($Script:Utf8.GetBytes($Texto))
        return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function Get-Pabellon([string]$Campo) {
    # "PM A PINGUELA<br>PM A PINGUELA - PISTA 1" -> "PM A PINGUELA - PISTA 1"
    $lineas = New-Object 'Collections.Generic.List[string]'
    foreach ($l in ((ConvertTo-TextoPlano $Campo) -split "`n")) {
        if ($l -and -not $lineas.Contains($l)) { $lineas.Add($l) }
    }
    $utiles = foreach ($l in $lineas) {
        $contenida = $false
        foreach ($otra in $lineas) {
            if ($otra -ne $l -and $otra.StartsWith($l, [StringComparison]::OrdinalIgnoreCase)) { $contenida = $true }
        }
        if (-not $contenida) { $l }
    }
    return (@($utiles) -join ' - ')
}

function Get-InfoCategoria([string]$Categoria, [string]$Competicion) {
    $base = (ConvertTo-UnaLinea $Categoria)
    $comp = (ConvertTo-UnaLinea $Competicion)
    $claveTexto = Get-Clave "$base $comp"
    $clave = 'otra'; $orden = 99
    for ($i = 0; $i -lt $Script:Categorias.Count; $i++) {
        if ($claveTexto -match $Script:Categorias[$i].Patron) { $clave = $Script:Categorias[$i].Clave; $orden = $i; break }
    }
    if (-not $base) { $base = 'Sin categoría' }
    $nombre = $Script:Inv.TextInfo.ToTitleCase($base.ToLowerInvariant())
    $nombre = $nombre -replace '\bAlevin\b', 'Alevín' -replace '\bBenjamin\b', 'Benjamín' -replace '\bDivision\b', 'División'
    # El sexo va al final del nombre de la competición: "TORNEO APERTURA CADETE F", "... NACIONAL FEMENINA".
    if ($nombre -notmatch '\s[FM]$' -and $comp -match '(?i)(?:^|\s)(F|M|FEM\.?|MASC\.?|FEMENIN[OA]|MASCULIN[OA])\s*$') {
        $nombre = "$nombre " + $Matches[1].Substring(0, 1).ToUpperInvariant()
    }
    return [pscustomobject]@{ Nombre = $nombre; Clave = $clave; Orden = $orden }
}

function Get-AnioTemporada([datetime]$Fecha) {
    # La temporada va del 1 de agosto al 31 de julio: se nombra por el año en que empieza.
    if ($Fecha.Month -ge 8) { return $Fecha.Year }
    return ($Fecha.Year - 1)
}

function Format-FechaCorta([datetime]$F) {
    return $Script:DiasCortos[[int]$F.DayOfWeek] + ' ' + $F.ToString('dd/MM', $Script:Inv)
}

function Format-Hora($P) {
    switch ($P.Estado) {
        'confirmada'  { return $P.Fecha.ToString('HH:mm', $Script:Inv) }
        'provisional' { return $P.Fecha.ToString('HH:mm', $Script:Inv) + ' (provisional)' }
        'sinhora'     { return 'Por confirmar' }
        default       { return 'Fecha y hora por confirmar' }
    }
}

function Test-ConHora($P) { return ($P.Estado -eq 'confirmada' -or $P.Estado -eq 'provisional') }

function Resolve-Ruta([string]$Ruta) {
    if ([IO.Path]::IsPathRooted($Ruta)) { return [IO.Path]::GetFullPath($Ruta) }
    return [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Ruta))
}

function Get-RutaAlternativa([string]$Ruta) {
    $dir = Split-Path $Ruta -Parent
    $nombre = [IO.Path]::GetFileNameWithoutExtension($Ruta)
    $ext = [IO.Path]::GetExtension($Ruta)
    return (Join-Path $dir ('{0} ({1}){2}' -f $nombre, (Get-Date).ToString('HHmmss'), $ext))
}

function Remove-CopiasAntiguas([string]$Ruta) {
    # Borra las copias "nombre (HHmmss).ext" que quedaron cuando el archivo estaba abierto.
    $dir = Split-Path $Ruta -Parent
    $nombre = [IO.Path]::GetFileNameWithoutExtension($Ruta)
    $ext = [IO.Path]::GetExtension($Ruta)
    $patron = '^' + [regex]::Escape($nombre) + ' \(\d{6}\)' + [regex]::Escape($ext) + '$'
    Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $patron } | ForEach-Object {
        try { Remove-Item -LiteralPath $_.FullName -ErrorAction Stop } catch { }
    }
}

function Save-Archivo([string]$Ruta, [scriptblock]$Escribir, [string]$Que) {
    # Si el archivo está abierto (p. ej. en Excel) se guarda con otro nombre en lugar de fallar.
    try {
        & $Escribir $Ruta
        Remove-CopiasAntiguas $Ruta
        return $Ruta
    } catch [IO.IOException] {
        $alt = Get-RutaAlternativa $Ruta
        & $Escribir $alt
        Write-Aviso "No se pudo sobrescribir $(Split-Path $Ruta -Leaf) (¿está abierto$Que?). Guardado como $(Split-Path $alt -Leaf)."
        return $alt
    }
}

function Save-Texto([string]$Ruta, [string]$Texto) {
    return (Save-Archivo $Ruta { param($r) [IO.File]::WriteAllText($r, $Texto, $Script:Utf8) } '')
}

# --- Descarga ----------------------------------------------------------------------------------

function Invoke-Isquad([string]$Ruta, [hashtable]$Datos) {
    $url = "$Script:UrlBase/$Ruta"
    $intentos = 3
    for ($i = 1; $i -le $intentos; $i++) {
        try {
            $p = @{
                Uri             = $url
                UseBasicParsing = $true
                TimeoutSec      = 45
                UserAgent       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) calendario-voley/1.0'
            }
            if ($Datos) { $p.Method = 'Post'; $p.Body = $Datos } else { $p.Method = 'Get' }
            $r = Invoke-WebRequest @p
            # Se decodifica a mano como UTF-8 para no depender de la versión de PowerShell.
            $texto = $Script:Utf8.GetString($r.RawContentStream.ToArray())
            return $texto.TrimStart([char]0xFEFF)
        } catch {
            if ($i -eq $intentos) {
                throw "No se pudo descargar $url`n    ($($_.Exception.Message))`n    Comprueba la conexión a Internet y vuelve a intentarlo."
            }
            Write-Aviso "La web de la federación no responde; reintentando ($($i + 1) de $intentos)..."
            Start-Sleep -Seconds (2 * $i)
        }
    }
}

function Get-PartidosApi([datetime]$Desde) {
    # Misma consulta que hace la "Agenda calendario": todos los partidos desde una fecha.
    $json = Invoke-Isquad 'json/partidos_equipos_consultas.php' @{
        accion        = 'obtener_partidos'
        id_ambito     = $Script:Ambito
        fecha_actual  = $Desde.ToString('yyyy-MM-dd', $Script:Inv)
        consulta      = '0'
        id_superficie = $Script:Superficie
    }
    try { $obj = $json | ConvertFrom-Json }
    catch { throw 'La web de la federación devolvió datos que no se entienden. Puede que haya cambiado; revisa si hay una versión nueva de esta herramienta.' }
    if ($null -eq $obj -or -not ($obj.PSObject.Properties.Name -contains 'data') -or $null -eq $obj.data) {
        throw 'La web de la federación devolvió una respuesta inesperada (falta la lista de partidos). Inténtalo más tarde.'
    }
    $obj.data | Where-Object { $null -ne $_ -and $_.PSObject.Properties['id_club_local'] }
}

function Get-FechaCruda($R) {
    # Día del partido tal como viene de iSquad ("aaaa-mm-dd").
    $f = [string]$R.fecha_calendario
    if (-not $f -and $R.fecha) { $f = ([string]$R.fecha).Substring(0, [Math]::Min(10, ([string]$R.fecha).Length)) }
    return $f
}

function Get-ClubsFederacion {
    # Nombre oficial de cada club (el ID coincide con id_club_local / id_club_visitante).
    $clubs = @{}
    try {
        $html = Invoke-Isquad "listado_clubs.php?id_territorial=$($Script:Ambito)&id_superficie=$($Script:Superficie)" $null
        $patron = 'afiliacion_clubs/(\d+)/[^''"]*[''"][^>]*?\balt\s*=\s*[''"]([^''"]*)[''"]'
        foreach ($m in [regex]::Matches($html, $patron)) {
            $id = $m.Groups[1].Value
            $nombre = ConvertTo-UnaLinea $m.Groups[2].Value
            if ($nombre -and -not $clubs.ContainsKey($id)) { $clubs[$id] = $nombre }
        }
    } catch {
        Write-Aviso 'No se pudo descargar el listado oficial de clubs; se usarán los nombres de los equipos.'
    }
    return $clubs
}

function Get-PrefijoComun($Nombres) {
    # "DOMPAVOLEI IF1", "DOMPAVOLEI CF1" -> "DOMPAVOLEI" (palabras completas, al menos 3 letras).
    $lista = @($Nombres | Where-Object { $_ })
    if ($lista.Count -lt 2) { return '' }
    $prefijo = $lista[0]
    foreach ($n in $lista) {
        $i = 0
        while ($i -lt $prefijo.Length -and $i -lt $n.Length -and $prefijo[$i] -eq $n[$i]) { $i++ }
        $prefijo = $prefijo.Substring(0, $i)
    }
    $corte = $prefijo.LastIndexOf(' ')
    if ($corte -lt 0) { return '' }
    $prefijo = $prefijo.Substring(0, $corte).Trim(' ', '-', '.', ',')
    if ($prefijo.Length -lt 3) { return '' }
    return $prefijo
}

function Get-CatalogoClubs($CrudosTemporada, $CrudosTodos) {
    # Clubs que se pueden elegir: los del listado oficial más los que aparecen en los partidos.
    # Se puede buscar por el nombre del club o por el de cualquiera de sus equipos.
    $oficiales = Get-ClubsFederacion
    $cuenta = @{}; $equipos = @{}
    foreach ($r in $CrudosTemporada) {
        foreach ($lado in @('local', 'visitante')) {
            $id = [string]$r.("id_club_$lado")
            if ($id -and $id -ne 'None') { $cuenta[$id] = 1 + [int]$cuenta[$id] }
        }
    }
    foreach ($r in $CrudosTodos) {
        foreach ($lado in @('local', 'visitante')) {
            $id = [string]$r.("id_club_$lado")
            if (-not $id -or $id -eq 'None') { continue }
            if (-not $equipos.ContainsKey($id)) { $equipos[$id] = New-Object 'Collections.Generic.HashSet[string]' }
            [void]$equipos[$id].Add([string]$r.("nombre_$lado"))
        }
    }
    $ids = @(@($oficiales.Keys) + @($equipos.Keys) | Sort-Object -Unique)
    $catalogo = foreach ($id in $ids) {
        $nombresEquipos = @()
        if ($equipos.ContainsKey($id)) { $nombresEquipos = @($equipos[$id] | ForEach-Object { ConvertTo-UnaLinea $_ } | Where-Object { $_ } | Sort-Object -Unique) }
        $oficial = $oficiales[$id]
        # Muchos clubs juegan con otro nombre (p. ej. el CV San Martiño es "DOMPAVOLEI"): se usa el
        # principio común de los nombres de sus equipos, si lo hay.
        $comun = Get-PrefijoComun $nombresEquipos
        $nombre = if ($comun) { $comun } elseif ($oficial) { $oficial } elseif ($nombresEquipos.Count) { $nombresEquipos[0] } else { "Club $id" }
        [pscustomobject]@{
            Id       = $id
            Nombre   = $nombre
            Oficial  = $(if ($oficial -and (Get-Clave $oficial) -ne (Get-Clave $nombre)) { $oficial } else { '' })
            Partidos = [int]$cuenta[$id]
            Orden    = (Get-Clave $nombre)
            Busqueda = @((Get-Clave $nombre), (Get-Clave $oficial)) + @($nombresEquipos | ForEach-Object { Get-Clave $_ })
        }
    }
    $catalogo | Sort-Object Orden
}

# --- Elegir club -------------------------------------------------------------------------------

function Find-Clubs($Catalogo, [string]$Texto) {
    $clave = Get-Clave $Texto
    if (-not $clave) { return }
    $patrones = @($clave -split ' ' | ForEach-Object { '\b' + [regex]::Escape($_) })
    foreach ($c in $Catalogo) {
        # Todas las palabras buscadas tienen que estar en el nombre del club o en el de uno de sus equipos.
        foreach ($texto in $c.Busqueda) {
            $ok = $true
            foreach ($p in $patrones) { if ($texto -notmatch $p) { $ok = $false; break } }
            if ($ok) { $c; break }
        }
    }
}

function Show-Catalogo($Lista, [string]$Temp) {
    Write-Host ''
    Write-Host ('   Nº  {0,-34} {1,-9} {2,-10} {3}' -f 'Club', 'Partidos', 'ID', 'Nombre oficial') -ForegroundColor Cyan
    for ($i = 0; $i -lt $Lista.Count; $i++) {
        $c = $Lista[$i]
        $n = if ($c.Partidos -gt 0) { [string]$c.Partidos } else { '-' }
        Write-Host ('  {0,3}  {1,-34} {2,8}  {3,-10} {4}' -f ($i + 1), $c.Nombre, $n, $c.Id, $c.Oficial)
    }
    Write-Host "  (Partidos = partidos publicados en la temporada $Temp)" -ForegroundColor DarkGray
    Write-Host ''
}

function Select-ClubInteractivo($Catalogo, [string]$Temp, [string]$Filtro) {
    Write-Host ''
    Write-Host '  ¿De qué club quieres el calendario?' -ForegroundColor White
    while ($true) {
        $lista = @(if ($Filtro) { Find-Clubs $Catalogo $Filtro } else { $Catalogo })
        if ($lista.Count -eq 0) {
            Write-Aviso "Ningún club ni equipo contiene «$Filtro». Se muestran todos."
            $Filtro = ''
            $lista = @($Catalogo)
        }
        Show-Catalogo $lista $Temp
        Write-Host '  Escribe el número de tu club (si son varios, sepáralos con comas)'
        $resp = Read-Host '  o parte del nombre para buscar'
        if ($null -eq $resp) { throw 'No se pudo leer la respuesta. Ejecuta de nuevo "Generar calendario.bat".' }
        $resp = $resp.Trim()
        if (-not $resp) { $Filtro = ''; continue }
        if ($resp -match '^[\d\s,;]+$') {
            $elegidos = @()
            $valido = $true
            foreach ($m in [regex]::Matches($resp, '\d+')) {
                $n = [long]$m.Value
                $porId = @($Catalogo | Where-Object { $_.Id -eq $m.Value })
                if ($porId.Count -gt 0) { $elegidos += $porId[0] }
                elseif ($n -ge 1 -and $n -le $lista.Count) { $elegidos += $lista[[int]$n - 1] }
                else { $valido = $false }
            }
            if ($valido -and $elegidos.Count -gt 0) { return ($elegidos | Sort-Object Id -Unique) }
            Write-Aviso "Escribe un número entre 1 y $($lista.Count)."
            continue
        }
        $Filtro = $resp
    }
}

function Read-Config {
    if (-not (Test-Path -LiteralPath $Script:RutaConfig)) { return $null }
    try {
        return (Get-Content -LiteralPath $Script:RutaConfig -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        Write-Aviso "config.json no se puede leer ($($_.Exception.Message)); se volverá a preguntar el club."
        return $null
    }
}

function Get-DuracionConfig($Cfg) {
    $n = 0
    if ($Cfg -and [int]::TryParse([string]$Cfg.duracion_minutos, [ref]$n) -and $n -gt 0 -and $n -le 600) { return $n }
    if ($Cfg -and $Cfg.duracion_minutos) { Write-Aviso "duracion_minutos de config.json no es un número válido; se usan 120 minutos." }
    return 120
}

function Save-Config($Clubs, [int]$Duracion, $Cfg) {
    $nuevo = [ordered]@{
        clubs            = @($Clubs | ForEach-Object { [ordered]@{ id = [string]$_.Id; nombre = [string]$_.Nombre } })
        duracion_minutos = $Duracion
    }
    if ($Cfg -and $Cfg.calendario_publicado) { $nuevo.calendario_publicado = [string]$Cfg.calendario_publicado }
    if ($Cfg -and $Cfg.salidas) { $nuevo.salidas = $Cfg.salidas }
    if ($Cfg -and $Cfg.pedir_bus) { $nuevo.pedir_bus = $Cfg.pedir_bus }
    [IO.File]::WriteAllText($Script:RutaConfig, (ConvertTo-Json -InputObject $nuevo -Depth 4), $Script:Utf8)
}

function Resolve-Clubs($CrudosTemporada, $CrudosTodos, [string]$Temp, $Cfg) {
    # Devuelve los clubs (Id, Nombre) a usar: -Club, luego config.json y, si no hay, se pregunta.
    if ($CambiarClub -and $SinPreguntar) { throw '-CambiarClub necesita preguntar el club; no se puede usar con -SinPreguntar (usa -Club).' }

    if ($Club) {
        $catalogo = @(Get-CatalogoClubs $CrudosTemporada $CrudosTodos)
        $elegidos = @()
        foreach ($trozo in ($Club -split '[,;]')) {
            $t = $trozo.Trim()
            if (-not $t) { continue }
            if ($t -match '^\d{5,}$') {
                $c = @($catalogo | Where-Object { $_.Id -eq $t })
                if ($c.Count) { $elegidos += $c[0] } else { $elegidos += [pscustomobject]@{ Id = $t; Nombre = "Club $t" } }
                continue
            }
            $encontrados = @(Find-Clubs $catalogo $t)
            if ($encontrados.Count -eq 1) { $elegidos += $encontrados[0] }
            elseif ($encontrados.Count -eq 0) { throw "Ningún club ni equipo coincide con «$t». Usa -ListarClubs para ver los disponibles." }
            elseif ($SinPreguntar) {
                $nombres = ($encontrados | ForEach-Object { "    $($_.Id)  $($_.Nombre)" }) -join "`n"
                throw "Hay varios clubs que coinciden con «$t»; indica el ID:`n$nombres"
            } else {
                $elegidos += @(Select-ClubInteractivo $encontrados $Temp '')
            }
        }
        return ($elegidos | Sort-Object Id -Unique)
    }

    if (-not $CambiarClub -and $Cfg -and $Cfg.clubs) {
        $lista = @($Cfg.clubs | Where-Object { $_.id } | ForEach-Object {
            $nombre = if ($_.nombre) { [string]$_.nombre } else { "Club $($_.id)" }
            [pscustomobject]@{ Id = [string]$_.id; Nombre = $nombre }
        })
        if ($lista.Count) { return $lista }
    }

    if ($SinPreguntar) { throw 'No hay ningún club configurado en config.json. Ejecuta sin -SinPreguntar o indica -Club.' }
    $elegidos = @(Select-ClubInteractivo @(Get-CatalogoClubs $CrudosTemporada $CrudosTodos) $Temp '')
    Save-Config $elegidos (Get-DuracionConfig $Cfg) $Cfg
    Write-Host ''
    Write-Host ("  Guardado en config.json: " + (($elegidos | ForEach-Object { $_.Nombre }) -join ' + ')) -ForegroundColor Green
    return $elegidos
}

# --- Partidos ----------------------------------------------------------------------------------

function ConvertTo-Partidos($Crudos, $IdsClub) {
    # Convierte los partidos del club (de todas las temporadas descargadas) a objetos limpios.
    $lista = New-Object 'Collections.Generic.List[object]'
    $sinFecha = 0
    $vistos = New-Object 'Collections.Generic.HashSet[string]'
    foreach ($r in $Crudos) {
        $idL = [string]$r.id_club_local
        $idV = [string]$r.id_club_visitante
        $esL = $IdsClub.Contains($idL)
        $esV = $IdsClub.Contains($idV)
        if (-not ($esL -or $esV)) { continue }

        $fecha = [datetime]::MinValue
        $ok = [datetime]::TryParseExact([string]$r.fecha, 'yyyy-MM-dd HH:mm:ss', $Script:Inv,
            [Globalization.DateTimeStyles]::None, [ref]$fecha)
        if (-not $ok) {
            $ok = [datetime]::TryParseExact((Get-FechaCruda $r), 'yyyy-MM-dd', $Script:Inv,
                [Globalization.DateTimeStyles]::None, [ref]$fecha)
        }
        if (-not $ok) { $sinFecha++; continue }

        # fecha_confirmada = "1": la federación ya publica el día (y la hora, si no es 00:00).
        # Sin confirmar, la web de la federación no enseña ni el día: es la jornada prevista.
        $tieneHora = $fecha.TimeOfDay.TotalMinutes -gt 0
        $confirmada = ([string]$r.fecha_confirmada) -eq '1'
        $estado = if ($confirmada) {
            if ($tieneHora) { 'confirmada' } else { 'sinhora' }
        } else {
            if ($tieneHora) { 'provisional' } else { 'pendiente' }
        }
        if (-not $tieneHora) { $fecha = $fecha.Date }

        $local = ConvertTo-UnaLinea $r.nombre_local
        $visit = ConvertTo-UnaLinea $r.nombre_visitante
        $comp = ConvertTo-UnaLinea $r.nombre_competicion
        $pab = Get-Pabellon $r.campo
        $cat = Get-InfoCategoria $r.categoria $r.nombre_competicion

        # iSquad a veces repite exactamente el mismo partido.
        $clave = '{0}|{1}|{2}|{3}|{4}' -f $fecha.ToString('yyyyMMddHHmm', $Script:Inv), $local, $visit, $comp, $pab
        if (-not $vistos.Add($clave)) { continue }

        $nuestros = @()
        if ($esL) { $nuestros += $local }
        if ($esV) { $nuestros += $visit }
        $cond = if ($esL -and $esV) { 'derbi' } elseif ($esL) { 'local' } else { 'visitante' }
        $rival = if ($cond -eq 'local') { $visit } elseif ($cond -eq 'visitante') { $local } else { '' }

        $lista.Add([pscustomobject]@{
            Fecha          = $fecha
            Temporada      = (Get-AnioTemporada $fecha)
            Estado         = $estado
            Local          = $local
            Visitante      = $visit
            EsLocal        = $esL
            EsVisitante    = $esV
            Condicion      = $cond
            Nuestros       = $nuestros
            Rival          = $rival
            Competicion    = $comp
            Categoria      = $cat.Nombre
            ClaveCategoria = $cat.Clave
            OrdenCategoria = $cat.Orden
            Pabellon       = $pab
            Uid            = ''
            # Los rellena Add-Salidas si config.json tiene "salidas".
            Inicio         = $fecha
            Salida         = $null
            Calentamiento  = $null
            ViajeMin       = $null
            ViajeFuente    = ''
            EnCasa         = $false
            Municipio      = ''
            Km             = $null
            Segundo        = $false
            SalidaPrimero  = $null
        })
    }
    if ($sinFecha -gt 0) { Write-Aviso "$sinFecha partido(s) sin fecha no se han incluido." }

    $ordenados = @($lista | Sort-Object Fecha, OrdenCategoria, Local, Visitante)

    # UID estable: si la federación cambia la fecha u hora, el calendario actualiza el evento en vez de
    # duplicarlo. Se numera dentro de cada temporada (ida, vuelta...) sin depender de -Desde/-Hasta.
    $veces = @{}
    foreach ($p in $ordenados) {
        $clave = (Get-Clave "$($p.Temporada)|$($p.Competicion)|$($p.Local)|$($p.Visitante)")
        $veces[$clave] = 1 + [int]$veces[$clave]
        $p.Uid = (Get-Hash "$clave|$($veces[$clave])").Substring(0, 24) + '@calendario-voley'
    }
    $ordenados
}

function Get-Equipos($Partidos, $Anteriores) {
    # Equipos del club con partidos en la temporada, más los de la temporada anterior que aún no
    # tienen: así su calendario (y su enlace) existe desde el principio.
    $info = [ordered]@{}
    foreach ($grupo in @(@{ Lista = @($Partidos); Actual = $true }, @{ Lista = @($Anteriores); Actual = $false })) {
        foreach ($p in $grupo.Lista) {
            foreach ($e in $p.Nuestros) {
                if (-not $info.Contains($e)) {
                    $info[$e] = @{ Actual = (New-Object 'Collections.Generic.List[object]'); Todos = (New-Object 'Collections.Generic.List[object]') }
                }
                if ($grupo.Actual) { $info[$e].Actual.Add($p) }
                $info[$e].Todos.Add($p)
            }
        }
    }
    $equipos = foreach ($nombre in $info.Keys) {
        [object[]]$actuales = $info[$nombre].Actual.ToArray()
        [object[]]$muestras = if ($actuales.Count) { $actuales } else { $info[$nombre].Todos.ToArray() }
        $top = $muestras | Group-Object Categoria | Sort-Object Count -Descending | Select-Object -First 1
        $muestra = $muestras | Where-Object { $_.Categoria -eq $top.Name } | Select-Object -First 1
        $equipo = New-Object psobject
        $equipo | Add-Member NoteProperty Nombre $nombre
        $equipo | Add-Member NoteProperty Categoria $muestra.Categoria
        $equipo | Add-Member NoteProperty ClaveCategoria $muestra.ClaveCategoria
        $equipo | Add-Member NoteProperty OrdenCategoria $muestra.OrdenCategoria
        $equipo | Add-Member NoteProperty Partidos $actuales
        $equipo | Add-Member NoteProperty Ics ''
        $equipo
    }
    $equipos | Sort-Object OrdenCategoria, Categoria, Nombre
}

# --- Hora de salida (viaje en bus + calentamiento) ----------------------------------------------
#
# Con "salidas" en config.json, cada partido con hora lleva también la hora de salida en bus desde el
# pabellón del club: salida = partido - calentamiento - viaje en bus. En casa, el evento empieza a la
# hora de calentamiento. El pabellón de cada partido se localiza con las coordenadas que publica la
# federación y el tiempo por carretera se calcula con OSRM (OpenStreetMap). Los resultados se guardan
# en pabellones.json para no repetir consultas.

$Script:RutaCachePabellones = Join-Path $Script:Carpeta 'pabellones.json'
$Script:PalabrasGenericas = @('PISTA', 'PABELLON', 'PAVILLON', 'POLIDEPORTIVO', 'MUNICIPAL', 'CAMPO', 'CAMPO1', 'CENTRAL', 'ANEXO',
    'PM', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'DEL', 'LOS', 'LAS', 'LA', 'EL', 'O', 'A', 'OS', 'AS', 'E', 'Y')

function ConvertTo-Numero($Valor, $Defecto) {
    if ($null -eq $Valor -or [string]$Valor -eq '') { return $Defecto }
    if ($Valor -is [ValueType]) { return [double]$Valor }
    $n = 0.0
    if ([double]::TryParse(([string]$Valor).Replace(',', '.'), [Globalization.NumberStyles]::Float, $Script:Inv, [ref]$n)) { return $n }
    return $Defecto
}

function Get-ConfigSalidas($Cfg) {
    if (-not $Cfg -or -not $Cfg.salidas) { return $null }
    $s = $Cfg.salidas
    $lat = ConvertTo-Numero $s.latitud $null
    $lon = ConvertTo-Numero $s.longitud $null
    if ($null -eq $lat -or $null -eq $lon) {
        Write-Aviso 'config.json: faltan "latitud" y "longitud" del pabellón de salida; no se calculan las horas de salida.'
        return $null
    }
    $manual = @{}
    if ($s.tiempos_viaje_minutos) {
        foreach ($p in $s.tiempos_viaje_minutos.PSObject.Properties) {
            $m = ConvertTo-Numero $p.Value $null
            if ($null -ne $m -and $m -ge 0) { $manual[(Get-Clave $p.Name)] = [int]$m }
            else { Write-Aviso "config.json: el tiempo de viaje de «$($p.Name)» no es un número de minutos; se ignora." }
        }
    }
    return [pscustomobject]@{
        Origen        = $(if ($s.origen) { [string]$s.origen } else { 'el pabellón del club' })
        Lat           = [double]$lat
        Lon           = [double]$lon
        Calentamiento = [int](ConvertTo-Numero $s.calentamiento_minutos 60)
        FactorBus     = [double](ConvertTo-Numero $s.factor_bus 1.10)
        Margen        = [int](ConvertTo-Numero $s.margen_minutos 0)
        # El viaje se redondea hacia arriba y la salida hacia abajo (a cuartos de hora): siempre con margen.
        RedondeoViaje = [Math]::Max(1, [int](ConvertTo-Numero $s.redondeo_viaje_minutos 15))
        Redondeo      = [Math]::Max(1, [int](ConvertTo-Numero $s.redondeo_salida_minutos 15))
        RadioCasaKm   = [double](ConvertTo-Numero $s.radio_casa_km 1)
        Manual        = $manual
    }
}

function Get-DistanciaKm([double]$Lat1, [double]$Lon1, [double]$Lat2, [double]$Lon2) {
    $rad = [Math]::PI / 180
    $dLat = ($Lat2 - $Lat1) * $rad
    $dLon = ($Lon2 - $Lon1) * $rad
    $a = [Math]::Pow([Math]::Sin($dLat / 2), 2) + [Math]::Cos($Lat1 * $rad) * [Math]::Cos($Lat2 * $rad) * [Math]::Pow([Math]::Sin($dLon / 2), 2)
    return 2.0 * 6371.0 * [Math]::Asin([Math]::Min([double]1.0, [Math]::Sqrt($a)))
}

function Format-Duracion([int]$Minutos) {
    $h = [Math]::Floor($Minutos / 60); $m = $Minutos % 60
    if ($h -eq 0) { return "$m min" }
    if ($m -eq 0) { return "$h h" }
    return "$h h $m min"
}

function Read-CachePabellones {
    $cache = @{}
    if (Test-Path -LiteralPath $Script:RutaCachePabellones) {
        try {
            $obj = Get-Content -LiteralPath $Script:RutaCachePabellones -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($p in $obj.PSObject.Properties) { $cache[$p.Name] = $p.Value }
        } catch { Write-Aviso 'pabellones.json no se puede leer; se volverán a calcular los viajes.' }
    }
    return $cache
}

function Save-CachePabellones($Cache) {
    $ordenado = [ordered]@{}
    foreach ($k in ($Cache.Keys | Sort-Object)) { $ordenado[$k] = $Cache[$k] }
    [IO.File]::WriteAllText($Script:RutaCachePabellones, (ConvertTo-Json -InputObject $ordenado -Depth 4), $Script:Utf8)
}

function Get-CamposFederacion([datetime]$Desde) {
    # Lista de pabellones de la federación (id, nombre, municipio).
    try {
        $json = Invoke-Isquad 'json/pabellones_consultas.php' @{
            accion = 'obtener_pabellones'; id_ambito = $Script:Ambito; fecha_actual = $Desde.ToString('yyyy-MM-dd', $Script:Inv)
        }
        foreach ($c in @(($json | ConvertFrom-Json).data)) {
            if (-not $c -or -not $c.id_campo) { continue }
            $nombre = ConvertTo-UnaLinea $c.nombre
            [pscustomobject]@{ Id = [string]$c.id_campo; Nombre = $nombre; Municipio = (ConvertTo-UnaLinea $c.municipio); Clave = (Get-Clave $nombre) }
        }
    } catch {
        Write-Aviso 'No se pudo descargar la lista de pabellones de la federación; algunas horas de salida quedarán sin calcular.'
    }
}

function Find-Campos([string]$Nombre, $Campos) {
    # Pabellones de la federación que corresponden al nombre que aparece en el partido, del más probable al menos.
    $clave = Get-Clave $Nombre
    if (-not $clave) { return }
    $exactos = @($Campos | Where-Object { $_.Clave -eq $clave })
    if ($exactos.Count) { return $exactos }
    $prefijos = @($Campos | Where-Object { $clave.StartsWith($_.Clave + ' ') -or $_.Clave.StartsWith($clave + ' ') } | Sort-Object { $_.Clave.Length } -Descending)
    if ($prefijos.Count) { return $prefijos }
    # Por palabras significativas (sin "PISTA", "PABELLÓN", números...).
    $significativas = { param($k) @($k -split ' ' | Where-Object { $_ -and $_ -notmatch '^\d+$' -and $Script:PalabrasGenericas -notcontains $_ }) }
    $mias = & $significativas $clave
    if (-not $mias.Count) { return }
    $puntuados = foreach ($c in $Campos) {
        $suyas = & $significativas $c.Clave
        if (-not $suyas.Count) { continue }
        $comunes = @($mias | Where-Object { $suyas -contains $_ }).Count
        $p = $comunes / [Math]::Max($mias.Count, $suyas.Count)
        if ($p -ge 0.6) { [pscustomobject]@{ Campo = $c; P = $p } }
    }
    $puntuados | Sort-Object P -Descending | ForEach-Object { $_.Campo }
}

function Repair-Texto([string]$Texto) {
    # iSquad guarda algunas direcciones con las tildes mal codificadas ("RÃºA" en vez de "RÚA").
    if ($Texto -match '[ÃÂ]') {
        try { $Texto = [Text.Encoding]::UTF8.GetString([Text.Encoding]::GetEncoding(28591).GetBytes($Texto)) } catch { }
    }
    return $Texto
}

function Test-Propiedad($Obj, [string]$Nombre) {
    if ($Obj -is [Collections.IDictionary]) { return $Obj.Contains($Nombre) }
    return [bool]$Obj.PSObject.Properties[$Nombre]
}

function Get-CoordenadasCampo([string]$Id) {
    # Coordenadas y dirección de un pabellón según la ficha de la federación.
    try {
        $obj = Invoke-Isquad 'json/pabellones_consultas.php' @{ accion = 'obtener_info_campo'; id = $Id } | ConvertFrom-Json
        $filas = $obj.data
        if ($filas -is [string]) { $filas = $filas | ConvertFrom-Json }
        foreach ($f in @($filas)) {
            $lat = ConvertTo-Numero $f.latitud $null
            $lon = ConvertTo-Numero $f.longitud $null
            if ($null -ne $lat -and $null -ne $lon -and ($lat -ne 0 -or $lon -ne 0)) {
                $dir = (Repair-Texto (ConvertTo-UnaLinea $f.direccion)).ToUpperInvariant() -replace ',\s*ESPA(Ñ|N)A\s*$', ''
                return [pscustomobject]@{ Lat = $lat; Lon = $lon; Direccion = $dir.Trim() }
            }
        }
    } catch { }
    return $null
}

function Get-RutaCoche([double]$Lat1, [double]$Lon1, [double]$Lat2, [double]$Lon2) {
    # Tiempo en coche por carretera (OSRM, servidor público de OpenStreetMap: una consulta por segundo como mucho).
    $url = 'https://router.project-osrm.org/route/v1/driving/{0},{1};{2},{3}?overview=false' -f `
        $Lon1.ToString($Script:Inv), $Lat1.ToString($Script:Inv), $Lon2.ToString($Script:Inv), $Lat2.ToString($Script:Inv)
    try {
        Start-Sleep -Milliseconds 1100
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30 -UserAgent 'calendario-voley/1.0'
        $obj = $Script:Utf8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
        if ($obj.code -eq 'Ok' -and @($obj.routes).Count) {
            $ruta = @($obj.routes)[0]
            return [pscustomobject]@{ Km = [Math]::Round($ruta.distance / 1000, 1); Minutos = [int][Math]::Ceiling($ruta.duration / 60); Fuente = 'osrm' }
        }
    } catch { }
    # Sin servicio de rutas: estimación a partir de la distancia en línea recta (se reintenta otro día).
    $km = (Get-DistanciaKm $Lat1 $Lon1 $Lat2 $Lon2) * 1.35
    return [pscustomobject]@{ Km = [Math]::Round($km, 1); Minutos = [int][Math]::Ceiling($km / 70 * 60); Fuente = 'estimado' }
}

function Resolve-Pabellones($Partidos, $Cfg, [datetime]$DesdeCampos) {
    # Coordenadas y tiempo en coche desde el origen para cada pabellón de los partidos (con caché).
    $cache = Read-CachePabellones
    $origen = '{0},{1}' -f $Cfg.Lat.ToString($Script:Inv), $Cfg.Lon.ToString($Script:Inv)
    $hoyTxt = (Get-Date).ToString('yyyy-MM-dd', $Script:Inv)
    $campos = $null
    $cambios = $false
    $nombres = @($Partidos | Where-Object { $_.Pabellon -and (Test-ConHora $_) } | ForEach-Object { $_.Pabellon } | Sort-Object -Unique)
    foreach ($n in $nombres) {
        $e = $cache[$n]
        if ($e -and $e.origen -eq $origen -and ($e.fuente -eq 'osrm' -or $e.fecha -eq $hoyTxt)) { continue }   # al día (o ya reintentado hoy)
        $lat = $null; $lon = $null; $idCampo = ''; $municipio = ''; $direccion = ''
        if ($e -and $null -ne $e.lat) {
            $lat = [double]$e.lat; $lon = [double]$e.lon; $idCampo = [string]$e.id_campo; $municipio = [string]$e.municipio; $direccion = [string]$e.direccion
        } else {
            if ($null -eq $campos) { $campos = @(Get-CamposFederacion $DesdeCampos) }
            foreach ($c in @(Find-Campos $n $campos)) {
                $coord = Get-CoordenadasCampo $c.Id
                if ($coord) { $lat = $coord.Lat; $lon = $coord.Lon; $idCampo = $c.Id; $municipio = $c.Municipio; $direccion = $coord.Direccion; break }
            }
        }
        if ($null -eq $lat) {
            $cache[$n] = [ordered]@{ fuente = 'sin-datos'; origen = $origen; fecha = $hoyTxt }
        } else {
            $ruta = Get-RutaCoche $Cfg.Lat $Cfg.Lon $lat $lon
            $cache[$n] = [ordered]@{
                id_campo = $idCampo; municipio = $municipio; direccion = $direccion; lat = $lat; lon = $lon
                km = $ruta.Km; minutos_coche = $ruta.Minutos; fuente = $ruta.Fuente; origen = $origen; fecha = $hoyTxt
            }
        }
        $cambios = $true
    }
    # Pabellones guardados antes de que se apuntara la dirección: se completa una sola vez.
    foreach ($n in $nombres) {
        $e = $cache[$n]
        if (-not $e -or $null -eq $e.lat -or -not $e.id_campo -or (Test-Propiedad $e 'direccion')) { continue }
        $info = Get-CoordenadasCampo ([string]$e.id_campo)
        $nuevo = [ordered]@{ id_campo = [string]$e.id_campo; municipio = [string]$e.municipio; direccion = $(if ($info) { $info.Direccion } else { '' }) }
        foreach ($k in @('lat', 'lon', 'km', 'minutos_coche', 'fuente', 'origen', 'fecha')) { $nuevo[$k] = $e.$k }
        $cache[$n] = $nuevo
        $cambios = $true
    }
    if ($cambios) {
        try { Save-CachePabellones $cache } catch { Write-Aviso "No se pudo guardar pabellones.json: $($_.Exception.Message)" }
    }
    return $cache
}

function Add-Salidas($Partidos, $Pabellones, $Cfg) {
    # Calcula calentamiento, viaje en bus y salida de cada partido con hora.
    $primeros = @{}
    foreach ($p in @($Partidos | Sort-Object Fecha)) {
        if (-not (Test-ConHora $p)) { continue }
        $e = if ($p.Pabellon) { $Pabellones[$p.Pabellon] } else { $null }
        $viaje = $null; $casa = $false
        if ($e -and $null -ne $e.lat) {
            $p.Municipio = [string]$e.municipio
            $p.Km = $e.km
            if ((Get-DistanciaKm $Cfg.Lat $Cfg.Lon ([double]$e.lat) ([double]$e.lon)) -le $Cfg.RadioCasaKm) { $casa = $true }
            elseif ($null -ne $e.minutos_coche) {
                $viaje = [int]([Math]::Ceiling(([double]$e.minutos_coche) * $Cfg.FactorBus / $Cfg.RedondeoViaje) * $Cfg.RedondeoViaje)
                $p.ViajeFuente = [string]$e.fuente
            }
        }
        # Un tiempo puesto a mano en config.json manda sobre el calculado (0 = en casa).
        $claveP = Get-Clave $p.Pabellon
        foreach ($k in $Cfg.Manual.Keys) {
            if ($claveP -and $k -and $claveP.Contains($k)) { $viaje = $Cfg.Manual[$k]; $casa = ($viaje -eq 0); $p.ViajeFuente = 'manual'; break }
        }
        $p.EnCasa = $casa
        $p.ViajeMin = if ($casa) { $null } else { $viaje }
        $p.Calentamiento = $p.Fecha.AddMinutes(-$Cfg.Calentamiento)

        # Concentraciones: si el mismo equipo ya juega antes ese día en el mismo pabellón, no hay otra salida.
        $grupo = '{0}|{1}|{2}' -f $p.Fecha.ToString('yyyyMMdd', $Script:Inv), ((@($p.Nuestros) | Sort-Object) -join '/'), $claveP
        if ($primeros.ContainsKey($grupo)) {
            $p.Segundo = $true
            $p.SalidaPrimero = $primeros[$grupo]
            $p.Inicio = $p.Fecha
            continue
        }
        if ($casa) {
            $p.Inicio = $p.Calentamiento
        } elseif ($null -ne $viaje) {
            $s = $p.Calentamiento.AddMinutes(-($viaje + $Cfg.Margen))
            $s = $s.AddSeconds(-$s.Second).AddMinutes(-(($s.Hour * 60 + $s.Minute) % $Cfg.Redondeo))
            $p.Salida = $s
            $p.Inicio = $s
        } else {
            $p.Inicio = $p.Calentamiento
        }
        $primeros[$grupo] = $p
    }
}

function Get-ConfigPedirBus($Cfg, $Salidas) {
    # Datos para el botón "Pedir bus" de la página (correo ya redactado para la empresa de autobuses).
    if (-not $Salidas -or -not $Cfg -or -not $Cfg.pedir_bus) { return $null }
    $b = $Cfg.pedir_bus
    return [ordered]@{
        para      = [string]$b.para
        cc        = [string]$b.cc
        plazas    = [string]$b.plazas
        firma     = [string]$b.firma
        origen    = $Salidas.Origen
        dirOrigen = [string]$b.direccion_origen
    }
}

function Get-LineasSalida($P, $Cfg) {
    # Líneas del detalle del evento con la salida, el viaje, el calentamiento y el partido.
    if (-not $Cfg) { return }
    if (-not (Test-ConHora $P)) { return 'La hora de salida se calculará cuando la federación publique la hora del partido.' }
    $hm = { param($f) $f.ToString('HH:mm', $Script:Inv) }
    if ($P.Segundo) {
        $ref = $P.SalidaPrimero
        $txt = '2º partido del día en este pabellón: se va con el primero'
        if ($ref -and $ref.Salida) { $txt += ' (salida a las ' + (& $hm $ref.Salida) + ')' }
        return @($txt, ('Partido: ' + (& $hm $P.Fecha)))
    }
    $lineas = @()
    if ($P.EnCasa) {
        $lineas += "En casa ($($Cfg.Origen))"
    } elseif ($P.Salida) {
        $lineas += "Salida en bus desde $($Cfg.Origen): " + (& $hm $P.Salida)
        $donde = @()
        if ($P.Municipio) { $donde += $P.Municipio }
        if ($null -ne $P.Km) { $donde += ('{0} km' -f ([double]$P.Km).ToString('0', $Script:Inv)) }
        $lineas += ('Viaje en bus: ' + (Format-Duracion $P.ViajeMin) + $(if ($P.ViajeFuente -eq 'manual') { '' } else { ' aprox.' }) +
            $(if ($donde.Count) { ' (' + ($donde -join ', ') + ')' } else { '' }))
    } else {
        $lineas += 'Tiempo de viaje sin calcular para este pabellón (se puede poner a mano en config.json).'
    }
    $lineas += ('Calentamiento: ' + (& $hm $P.Calentamiento))
    $lineas += ('Partido: ' + (& $hm $P.Fecha) + $(if ($P.Estado -eq 'provisional') { ' (provisional)' } else { '' }))
    return $lineas
}

# --- ICS ---------------------------------------------------------------------------------------

function ConvertTo-TextoIcs([string]$Texto) {
    if (-not $Texto) { return '' }
    return ($Texto -replace '\\', '\\' -replace ';', '\;' -replace ',', '\,' -replace "`r?`n", '\n')
}

function Add-LineaIcs([Text.StringBuilder]$Sb, [string]$Linea) {
    # RFC 5545: líneas de 75 octetos como máximo; las siguientes empiezan por un espacio.
    if ($Script:Utf8.GetByteCount($Linea) -le 75) { [void]$Sb.Append($Linea).Append("`r`n"); return }
    $bytes = 0
    $i = 0
    while ($i -lt $Linea.Length) {
        $largo = if ([char]::IsHighSurrogate($Linea[$i]) -and ($i + 1) -lt $Linea.Length) { 2 } else { 1 }
        $trozo = $Linea.Substring($i, $largo)
        $b = $Script:Utf8.GetByteCount($trozo)
        if ($bytes + $b -gt 75) {
            [void]$Sb.Append("`r`n ")
            $bytes = 1
        }
        [void]$Sb.Append($trozo)
        $bytes += $b
        $i += $largo
    }
    [void]$Sb.Append("`r`n")
}

function Get-SufijoEstado($P) {
    switch ($P.Estado) {
        'provisional' { return ' (fecha y hora provisionales)' }
        'sinhora'     { return ' (hora por confirmar)' }
        'pendiente'   { return ' (fecha y hora por confirmar)' }
        default       { return '' }
    }
}

function New-Ics($Partidos, [string]$NombreCalendario, [string]$Descripcion, [int]$Duracion, [datetime]$Generado, $Salidas) {
    $Partidos = @($Partidos)
    $sb = New-Object Text.StringBuilder
    $sello = $Generado.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'", $Script:Inv)
    # SEQUENCE crece en cada generación: Google y Outlook solo aplican un cambio si es mayor que el anterior.
    $secuencia = [int][Math]::Floor(([DateTimeOffset]$Generado.ToUniversalTime()).ToUnixTimeSeconds() / 60)
    $cabecera = @(
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//calendario-voley//Calendario de voleibol (volei.gal)//ES',
        'CALSCALE:GREGORIAN'
    )
    # METHOD:PUBLISH exige al menos un evento; un calendario todavía vacío va sin él.
    if ($Partidos.Count -gt 0) { $cabecera += 'METHOD:PUBLISH' }
    $cabecera += @(
        ('X-WR-CALNAME:' + (ConvertTo-TextoIcs $NombreCalendario)),
        ('X-WR-CALDESC:' + (ConvertTo-TextoIcs $Descripcion)),
        "X-WR-TIMEZONE:$Script:ZonaHoraria",
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
        'BEGIN:VTIMEZONE',
        "TZID:$Script:ZonaHoraria",
        "X-LIC-LOCATION:$Script:ZonaHoraria",
        'BEGIN:DAYLIGHT',
        'TZOFFSETFROM:+0100',
        'TZOFFSETTO:+0200',
        'TZNAME:CEST',
        'DTSTART:19700329T020000',
        'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
        'END:DAYLIGHT',
        'BEGIN:STANDARD',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0100',
        'TZNAME:CET',
        'DTSTART:19701025T030000',
        'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
        'END:STANDARD',
        'END:VTIMEZONE'
    )
    foreach ($l in $cabecera) { Add-LineaIcs $sb $l }

    $actualizado = $Generado.ToString('dd/MM/yyyy HH:mm', $Script:Inv)
    foreach ($p in $Partidos) {
        $conHora = Test-ConHora $p
        $inicio = if ($conHora -and $p.Inicio) { $p.Inicio } else { $p.Fecha }
        # El evento empieza a la hora de salida (o de calentamiento): el título lleva la hora del partido.
        $titulo = $(if ($p.Salida) { [char]::ConvertFromUtf32(0x1F68C) + ' ' } else { '' }) + "$($p.Categoria) · $($p.Local) - $($p.Visitante)"
        if ($conHora -and $inicio -ne $p.Fecha) { $titulo += ' · partido ' + $p.Fecha.ToString('HH:mm', $Script:Inv) }
        $titulo += (Get-SufijoEstado $p)
        $juega = switch ($p.Condicion) {
            'local'     { "$($p.Local) juega como local" }
            'visitante' { "$($p.Visitante) juega como visitante" }
            default     { 'Partido entre dos equipos del club' }
        }
        $cuando = switch ($p.Estado) {
            'confirmada'  { 'Hora: ' + $p.Fecha.ToString('HH:mm', $Script:Inv) }
            'provisional' { 'Fecha y hora provisionales (' + $p.Fecha.ToString('HH:mm', $Script:Inv) + '): la federación aún no las ha confirmado' }
            'sinhora'     { 'Hora: por confirmar' }
            default       { 'Fecha y hora por confirmar: el día indicado es el de la jornada prevista' }
        }
        $lineasSalida = @(Get-LineasSalida $p $Salidas)
        if ($lineasSalida.Count) { $lineasSalida += '' }
        $desc = @(@($lineasSalida) + @(
            $juega,
            "Competición: $($p.Competicion)",
            "Categoría: $($p.Categoria)",
            "Local: $($p.Local)",
            "Visitante: $($p.Visitante)",
            "Pabellón: $(if ($p.Pabellon) { $p.Pabellon } else { 'por confirmar' })",
            $(if ($Salidas -and $conHora) { $null } else { $cuando }),
            '',
            "Datos de la Federación Galega de Voleibol ($Script:UrlFuente), actualizados el $actualizado. Los horarios pueden cambiar."
        ) | Where-Object { $null -ne $_ }) -join "`n"
        $lugar = $p.Pabellon
        if ($lugar -and $p.Municipio -and (Get-Clave $lugar) -notmatch ('\b' + [regex]::Escape((Get-Clave $p.Municipio)) + '\b')) { $lugar += ", $($p.Municipio)" }

        Add-LineaIcs $sb 'BEGIN:VEVENT'
        Add-LineaIcs $sb "UID:$($p.Uid)"
        Add-LineaIcs $sb "DTSTAMP:$sello"
        Add-LineaIcs $sb "LAST-MODIFIED:$sello"
        Add-LineaIcs $sb "SEQUENCE:$secuencia"
        if ($conHora) {
            Add-LineaIcs $sb ("DTSTART;TZID=$($Script:ZonaHoraria):" + $inicio.ToString("yyyyMMdd'T'HHmmss", $Script:Inv))
            Add-LineaIcs $sb ("DTEND;TZID=$($Script:ZonaHoraria):" + $p.Fecha.AddMinutes($Duracion).ToString("yyyyMMdd'T'HHmmss", $Script:Inv))
            Add-LineaIcs $sb 'TRANSP:OPAQUE'
        } else {
            Add-LineaIcs $sb ('DTSTART;VALUE=DATE:' + $p.Fecha.ToString('yyyyMMdd', $Script:Inv))
            Add-LineaIcs $sb ('DTEND;VALUE=DATE:' + $p.Fecha.AddDays(1).ToString('yyyyMMdd', $Script:Inv))
            Add-LineaIcs $sb 'TRANSP:TRANSPARENT'
        }
        Add-LineaIcs $sb ('SUMMARY:' + (ConvertTo-TextoIcs $titulo))
        if ($lugar) { Add-LineaIcs $sb ('LOCATION:' + (ConvertTo-TextoIcs $lugar)) }
        Add-LineaIcs $sb ('DESCRIPTION:' + (ConvertTo-TextoIcs $desc))
        Add-LineaIcs $sb ('CATEGORIES:' + (ConvertTo-TextoIcs $p.Categoria))
        Add-LineaIcs $sb ('STATUS:' + $(if ($p.Estado -eq 'confirmada') { 'CONFIRMED' } else { 'TENTATIVE' }))
        Add-LineaIcs $sb "URL:$Script:UrlFuente"
        Add-LineaIcs $sb 'END:VEVENT'
    }
    Add-LineaIcs $sb 'END:VCALENDAR'
    return $sb.ToString()
}

# --- Excel (.xlsx) -----------------------------------------------------------------------------

function ConvertTo-TextoXml([string]$Texto) {
    if (-not $Texto) { return '' }
    $t = $Texto -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', ''
    return [Security.SecurityElement]::Escape($t)
}

function Get-LetraColumna([int]$Indice) { return [string][char](65 + $Indice) }   # hasta 26 columnas

function Get-TextoSalida($P) {
    if (-not (Test-ConHora $P)) { return '' }
    if ($P.Segundo) { return '2º partido' }
    if ($P.EnCasa) { return 'En casa' }
    if ($P.Salida) { return $P.Salida.ToString('HH:mm', $Script:Inv) }
    return 'Sin calcular'
}

function Save-Xlsx($Partidos, [string]$Ruta, [datetime]$Generado, [string]$NombreClub, $Salidas) {
    Add-Type -AssemblyName System.IO.Compression
    # T = título, A = ancho, E = estilo (0 normal, 1 fecha, 4 ajustar texto), V = valor de cada fila.
    $columnas = @(
        @{ T = 'Fecha';             A = 11; E = 1 },
        @{ T = 'Día';               A = 10; E = 0; V = { param($p) $Script:Dias[[int]$p.Fecha.DayOfWeek] } }
    )
    if ($Salidas) {
        $columnas += @(
            @{ T = 'Salida (bus)';  A = 12; E = 0; V = { param($p) Get-TextoSalida $p } },
            @{ T = 'Viaje en bus';  A = 13; E = 0; V = { param($p) if ($null -ne $p.ViajeMin -and -not $p.Segundo) { Format-Duracion $p.ViajeMin } else { '' } } },
            @{ T = 'Calentamiento'; A = 14; E = 0; V = { param($p) if ($p.Calentamiento -and -not $p.Segundo) { $p.Calentamiento.ToString('HH:mm', $Script:Inv) } else { '' } } }
        )
    }
    $columnas += @(
        @{ T = $(if ($Salidas) { 'Partido' } else { 'Hora' }); A = 16; E = 0; Hora = $true; V = { param($p) Format-Hora $p } },
        @{ T = 'Equipo del club';   A = 22; E = 4; V = { param($p) (@($p.Nuestros) | Sort-Object) -join ' / ' } },
        @{ T = 'Rival';             A = 34; E = 4; V = { param($p) if ($p.Rival) { $p.Rival } else { '(derbi)' } } },
        @{ T = 'Local / visitante'; A = 16; E = 0; V = { param($p) switch ($p.Condicion) { 'local' { 'Local' } 'visitante' { 'Visitante' } default { 'Derbi' } } } },
        @{ T = 'Categoría';         A = 13; E = 0; V = { param($p) $p.Categoria } },
        @{ T = 'Competición';       A = 30; E = 4; V = { param($p) $p.Competicion } },
        @{ T = 'Pabellón';          A = 38; E = 4; V = { param($p) $p.Pabellon } }
    )
    if ($Salidas) { $columnas += @{ T = 'Municipio'; A = 18; E = 0; V = { param($p) $p.Municipio } } }
    $columnas += @(
        @{ T = 'Equipo local';      A = 32; E = 4; V = { param($p) $p.Local } },
        @{ T = 'Equipo visitante';  A = 32; E = 4; V = { param($p) $p.Visitante } }
    )
    $ultima = Get-LetraColumna ($columnas.Count - 1)
    $filas = $Partidos.Count + 1

    $sb = New-Object Text.StringBuilder
    [void]$sb.Append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    [void]$sb.Append('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">')
    [void]$sb.Append('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
    [void]$sb.Append("<dimension ref=""A1:$ultima$filas""/>")
    [void]$sb.Append('<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>')
    [void]$sb.Append('<sheetFormatPr defaultRowHeight="15"/><cols>')
    for ($c = 0; $c -lt $columnas.Count; $c++) {
        [void]$sb.Append(('<col min="{0}" max="{0}" width="{1}" customWidth="1"/>' -f ($c + 1), $columnas[$c].A))
    }
    [void]$sb.Append('</cols><sheetData>')

    $celdaTexto = { param($ref, $valor, $estilo) '<c r="{0}" t="inlineStr" s="{1}"><is><t xml:space="preserve">{2}</t></is></c>' -f $ref, $estilo, (ConvertTo-TextoXml $valor) }

    [void]$sb.Append('<row r="1">')
    for ($c = 0; $c -lt $columnas.Count; $c++) {
        [void]$sb.Append((& $celdaTexto ((Get-LetraColumna $c) + '1') $columnas[$c].T 2))
    }
    [void]$sb.Append('</row>')

    $fila = 1
    foreach ($p in $Partidos) {
        $fila++
        [void]$sb.Append("<row r=""$fila"">")
        $serial = $p.Fecha.Date.ToOADate().ToString($Script:Inv)
        [void]$sb.Append("<c r=""A$fila"" s=""1""><v>$serial</v></c>")
        for ($c = 1; $c -lt $columnas.Count; $c++) {
            $col = $columnas[$c]
            $estilo = if ($col.Hora -and $p.Estado -ne 'confirmada') { 3 } else { $col.E }
            [void]$sb.Append((& $celdaTexto ((Get-LetraColumna $c) + $fila) ([string](& $col.V $p)) $estilo))
        }
        [void]$sb.Append('</row>')
    }
    [void]$sb.Append('</sheetData>')
    [void]$sb.Append("<autoFilter ref=""A1:$ultima$filas""/>")
    [void]$sb.Append('<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>')
    [void]$sb.Append('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>')
    $pie = '&L&8' + $NombreClub + ' · generado el ' + $Generado.ToString('dd/MM/yyyy HH:mm', $Script:Inv) + ' · fuente: volei.gal&R&8Página &P de &N'
    [void]$sb.Append('<headerFooter><oddFooter>' + (ConvertTo-TextoXml $pie) + '</oddFooter></headerFooter>')
    [void]$sb.Append('</worksheet>')
    $hoja = $sb.ToString()

    $archivos = [ordered]@{
        '[Content_Types].xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
        '_rels/.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
        'xl/workbook.xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Partidos" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Partidos!$A$1:$' + $ultima + '$' + $filas + '</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">Partidos!$1:$1</definedName></definedNames></workbook>'
        'xl/_rels/workbook.xml.rels' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
        'xl/styles.xml' = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="11"/><color rgb="FF9C5700"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E4C92"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
        'xl/worksheets/sheet1.xml' = $hoja
    }

    $escribir = {
        param($destino)
        $fs = [IO.File]::Open($destino, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try {
            $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
            try {
                foreach ($nombre in $archivos.Keys) {
                    $entrada = $zip.CreateEntry($nombre, [IO.Compression.CompressionLevel]::Optimal)
                    $w = New-Object IO.StreamWriter($entrada.Open(), $Script:Utf8)
                    try { $w.Write($archivos[$nombre]) } finally { $w.Dispose() }
                }
            } finally { $zip.Dispose() }
        } finally { $fs.Dispose() }
    }
    return (Save-Archivo $Ruta $escribir ' en Excel')
}

# --- Historial (para detectar cambios) ---------------------------------------------------------

function Save-Historial($Partidos, [string]$Ruta, [string]$NombreClub, [string]$Temp) {
    # Lista estable, sin fecha de generación: el archivo solo cambia cuando cambian los partidos.
    $lineas = New-Object 'Collections.Generic.List[string]'
    $lineas.Add("# Partidos de $NombreClub, temporada $Temp (Federación Galega de Voleibol)")
    $lineas.Add('# fecha | hora | categoría | local - visitante | pabellón | competición')
    foreach ($p in $Partidos) {
        $lineas.Add(('{0} {1} | {2} | {3} | {4} - {5} | {6} | {7}' -f $Script:DiasCortos[[int]$p.Fecha.DayOfWeek],
            $p.Fecha.ToString('yyyy-MM-dd', $Script:Inv), (Format-Hora $p), $p.Categoria, $p.Local, $p.Visitante, $p.Pabellon, $p.Competicion))
    }
    $dir = Split-Path $Ruta -Parent
    if ($dir) { [void](New-Item -ItemType Directory -Force -Path $dir) }
    [IO.File]::WriteAllText($Ruta, (($lineas -join "`n") + "`n"), $Script:Utf8)
}

# --- HTML --------------------------------------------------------------------------------------

$Script:PlantillaHtml = @'
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>__TITULO__</title>
<link rel="preconnect" href="https://fonts.bunny.net">
<link rel="stylesheet" href="https://fonts.bunny.net/css?family=barlow:400,500,600|barlow-condensed:500,600,700|big-shoulders-display:700,800&amp;display=swap">
<style>
:root {
  --libre: #0A3A70;      /* zona libre alrededor de la pista */
  --pista: #0E4C92;      /* azul de pista */
  --balon: #FFC915;      /* amarillo balón: solo para lo más importante */
  --balon-tinta: #2A2100;
  --fondo: #EDF1F6;
  --superficie: #FFFFFF;
  --tinta: #0B1726;
  --tinta-2: #4A5A6E;
  --borde: #D5DDE8;
  --visitante: #5B6B7F;
  --foco: #0E4C92;
  --c-benjamin: #8E44AD; --c-alevin: #0B7361; --c-infantil: #2474C9; --c-cadete: #C45100;
  --c-juvenil: #B0306A;  --c-junior: #1E8449; --c-senior: #34495E;   --c-otra: #8A6D00;
  --display: 'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif;
  --cond: 'Barlow Condensed', 'Arial Narrow', 'Segoe UI', sans-serif;
  --texto: 'Barlow', system-ui, 'Segoe UI', Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #0A121D; --superficie: #111C2B; --tinta: #E6EDF5; --tinta-2: #9AABBF; --borde: #23344A; --visitante: #8C9BAE;
    --foco: #FFC915;
    --c-benjamin: #C08BE0; --c-alevin: #3CC4A6; --c-infantil: #6AAAF0; --c-cadete: #F2994A;
    --c-juvenil: #F27BB4;  --c-junior: #5BCB86; --c-senior: #A9B8CB;  --c-otra: #D9B642;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--fondo); color: var(--tinta); font: 400 16px/1.45 var(--texto); }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; border-radius: 4px; }
.cabecera :focus-visible { outline-color: var(--balon); }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.solo-impresion { display: none; }
.envoltura { max-width: 1060px; margin: 0 auto; padding: 0 16px; }

/* Cabecera: una pista vista desde arriba */
.cabecera { background: var(--libre); color: #fff; padding: 22px 0 26px; }
.pista {
  position: relative; background: var(--pista); border: 2px solid rgba(255,255,255,.55);
  padding: 26px 28px 24px; overflow: hidden;
}
.pista::before, .pista::after { content: ''; position: absolute; top: 0; bottom: 0; pointer-events: none; }
.pista::before {  /* líneas de ataque */
  left: 33.333%; right: 33.333%;
  border-left: 2px solid rgba(255,255,255,.22); border-right: 2px solid rgba(255,255,255,.22);
}
.pista::after {   /* la red */
  left: calc(50% - 2px); width: 4px; background: rgba(255,255,255,.42);
}
.pista > * { position: relative; z-index: 1; }
.antetitulo { font: 600 .95rem/1 var(--cond); letter-spacing: .14em; text-transform: uppercase; opacity: .85; margin: 0 0 10px; }
h1 { font: 800 clamp(2.1rem, 6.4vw, 4.4rem)/.92 var(--display); letter-spacing: .01em; text-transform: uppercase; margin: 0; max-width: 16ch; }
.resumen { margin: 14px 0 0; font: 500 1.05rem/1.4 var(--cond); letter-spacing: .02em; }
.resumen strong { font-weight: 700; }
.acciones { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
.boton {
  display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 16px; border-radius: 999px;
  font: 600 1rem/1 var(--cond); letter-spacing: .04em; text-transform: uppercase; text-decoration: none;
  border: 2px solid rgba(255,255,255,.75); color: #fff; background: transparent; cursor: pointer;
}
.boton:hover { background: rgba(255,255,255,.1); }
.boton.principal { background: var(--balon); border-color: var(--balon); color: var(--balon-tinta); }
.boton.principal:hover { background: #FFD84D; }
.ayuda-cal { margin-top: 14px; font-size: .92rem; max-width: 72ch; }
.ayuda-cal summary { cursor: pointer; font: 600 .95rem/1.2 var(--cond); letter-spacing: .04em; text-transform: uppercase; opacity: .9; }
.ayuda-cal ul { margin: 8px 0 0; padding-left: 20px; }
.ayuda-cal li { margin: 5px 0; }
.ayuda-cal code { font-size: .85em; word-break: break-all; background: rgba(255,255,255,.12); padding: 1px 4px; border-radius: 3px; }

/* Filtros */
.filtros { position: sticky; top: 0; z-index: 5; background: var(--fondo); border-bottom: 1px solid var(--borde); padding: 10px 0 12px; }
.fila-filtros { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; }
.equipos-chips { display: flex; gap: 8px; overflow-x: auto; padding: 6px 6px 10px; margin: 0 -6px; scrollbar-width: thin; }
.chip {
  --c: var(--c-otra); flex: none; display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 12px;
  border-radius: 999px; border: 1.5px solid var(--borde); background: var(--superficie); color: var(--tinta);
  font: 600 .95rem/1 var(--cond); letter-spacing: .02em; cursor: pointer; white-space: nowrap;
}
.chip::before { content: ''; width: 9px; height: 9px; border-radius: 50%; background: var(--c); }
.chip[aria-pressed="true"] { border-color: var(--c); background: color-mix(in srgb, var(--c) 16%, var(--superficie)); }
.chip.todos::before { display: none; }
.chip.todos[aria-pressed="true"] { background: var(--pista); border-color: var(--pista); color: #fff; }
.chip .cat-chip { font-weight: 500; color: var(--tinta-2); }
.segmentado { display: inline-flex; border: 1.5px solid var(--borde); border-radius: 999px; overflow: hidden; background: var(--superficie); }
.segmentado button {
  border: 0; background: transparent; color: var(--tinta-2); padding: 0 14px; min-height: 34px; cursor: pointer;
  font: 600 .92rem/1 var(--cond); letter-spacing: .05em; text-transform: uppercase;
}
.segmentado button[aria-pressed="true"] { background: var(--pista); color: #fff; }
.segmentado button:focus-visible { outline-offset: -3px; }
.oculto { display: none !important; }

/* Lista */
main { padding: 8px 0 40px; }
.dia { margin-top: 26px; }
.dia-cabecera { display: flex; align-items: baseline; gap: 12px; margin: 0; padding-bottom: 8px; border-bottom: 2px solid var(--tinta); font: inherit; }
.dia-num { font: 800 2.6rem/.8 var(--display); }
.dia-nombre { font: 700 1.25rem/1 var(--cond); text-transform: uppercase; letter-spacing: .05em; }
.dia-mes { font: 500 1.25rem/1 var(--cond); text-transform: uppercase; letter-spacing: .05em; color: var(--tinta-2); }
.dia-cuenta { margin-left: auto; font: 500 .95rem/1 var(--cond); color: var(--tinta-2); letter-spacing: .03em; }
.dia.pasado .dia-cabecera { border-bottom-color: var(--borde); }
.dia.pasado .dia-num, .dia.pasado .dia-nombre { color: var(--tinta-2); }
.dia.pasado .partido { background: transparent; }

.partido {
  --c: var(--c-otra); display: grid; grid-template-columns: 92px 1fr auto; gap: 4px 16px; align-items: start;
  padding: 14px 14px 14px 12px; border-bottom: 1px solid var(--borde); border-left: 5px solid var(--c); background: var(--superficie);
}
.hora { font: 700 1.55rem/1 var(--cond); font-variant-numeric: tabular-nums; letter-spacing: .01em; padding-top: 2px; }
.hora small { display: block; margin-top: 4px; font: 600 .78rem/1.1 var(--cond); letter-spacing: .06em; text-transform: uppercase; color: var(--c-cadete); }
.hora.pendiente { font-size: .95rem; line-height: 1.1; text-transform: uppercase; letter-spacing: .05em; color: var(--c-cadete); padding-top: 4px; }
.hora .etq { display: block; margin-bottom: 4px; font: 700 .72rem/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; color: var(--tinta-2); }
.hora .etq.bus { color: var(--pista); }
@media (prefers-color-scheme: dark) { .hora .etq.bus { color: var(--balon); } }
.hora small.partido-h { color: var(--tinta-2); font-weight: 600; letter-spacing: .03em; text-transform: none; font-size: .85rem; }
.viaje { margin-top: 5px; font: 600 .95rem/1.3 var(--cond); letter-spacing: .02em; }
.boton-bus {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 9px; min-height: 34px; padding: 0 14px; border-radius: 999px;
  background: var(--pista); color: #fff; text-decoration: none; font: 700 .88rem/1 var(--cond); letter-spacing: .06em; text-transform: uppercase;
}
.boton-bus:hover { background: var(--libre); }
.categoria { font: 700 .92rem/1 var(--cond); letter-spacing: .08em; text-transform: uppercase; color: var(--c); }
.equipos { margin-top: 5px; font: 600 1.14rem/1.25 var(--cond); letter-spacing: .01em; }
.equipos .vs { font-weight: 500; color: var(--tinta-2); margin: 0 6px; text-transform: lowercase; }
.equipos .rival { font-weight: 500; color: var(--tinta-2); }
.detalle { margin-top: 5px; font-size: .9rem; color: var(--tinta-2); }
.detalle a { text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); text-underline-offset: 2px; }
.condicion {
  align-self: center; font: 700 .82rem/1 var(--cond); letter-spacing: .1em; text-transform: uppercase;
  padding: 6px 10px; border-radius: 999px; border: 1.5px solid var(--visitante); color: var(--visitante); white-space: nowrap;
}
.condicion.local, .condicion.derbi { background: var(--pista); border-color: var(--pista); color: #fff; }
.proximo-marca {
  display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; padding: 3px 8px 3px 5px; border-radius: 999px;
  background: var(--balon); color: var(--balon-tinta); font: 700 .75rem/1 var(--cond); letter-spacing: .08em; text-transform: uppercase; vertical-align: 2px;
}
.proximo-marca::before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #fff 0 22%, transparent 23%), #E0A800; }

/* Mes */
.mes-barra { display: flex; align-items: center; justify-content: space-between; margin: 22px 0 10px; }
.mes-titulo { font: 800 2rem/1 var(--display); text-transform: uppercase; margin: 0; }
.mes-nav { display: flex; gap: 8px; }
.mes-nav button {
  width: 40px; height: 40px; border-radius: 50%; border: 1.5px solid var(--borde); background: var(--superficie); color: var(--tinta);
  font: 700 1.2rem/1 var(--cond); cursor: pointer;
}
.mes-nav button:disabled { opacity: .35; cursor: default; }
.rejilla { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--borde); border-left: 1px solid var(--borde); }
.rejilla .sem { font: 700 .8rem/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; color: var(--tinta-2); padding: 8px 6px; border-right: 1px solid var(--borde); border-bottom: 1px solid var(--borde); }
.celda { min-height: 104px; padding: 6px; border-right: 1px solid var(--borde); border-bottom: 1px solid var(--borde); background: var(--superficie); }
.celda.fuera-mes { background: transparent; }
.celda.con-partidos { cursor: pointer; }
.celda.con-partidos:hover { background: color-mix(in srgb, var(--pista) 7%, var(--superficie)); }
.celda .num { font: 700 1.05rem/1 var(--cond); }
.celda.hoy .num { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--balon); color: var(--balon-tinta); }
.mini { --c: var(--c-otra); display: block; margin-top: 4px; padding: 2px 5px; border-left: 3px solid var(--c); font: 600 .8rem/1.2 var(--cond); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mini b { font-variant-numeric: tabular-nums; }
.mas { display: block; margin-top: 4px; font: 600 .78rem/1 var(--cond); color: var(--tinta-2); }
.puntos { display: none; gap: 3px; flex-wrap: wrap; margin-top: 6px; }
.puntos i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }

.vacio { margin: 40px 0; padding: 28px; border: 2px dashed var(--borde); text-align: center; color: var(--tinta-2); }
.vacio button { margin-top: 12px; }
.boton.claro { border-color: var(--pista); color: var(--pista); }
@media (prefers-color-scheme: dark) { .boton.claro { border-color: var(--tinta-2); color: var(--tinta); } }

footer { border-top: 1px solid var(--borde); padding: 22px 0 40px; font-size: .9rem; color: var(--tinta-2); }
footer h2 { font: 700 1rem/1 var(--cond); letter-spacing: .08em; text-transform: uppercase; color: var(--tinta); margin: 0 0 10px; }
.lista-ics { columns: 2 300px; padding: 0; margin: 0 0 20px; list-style: none; }
.lista-ics li { break-inside: avoid; padding: 4px 0 6px; }
.lista-ics b { color: var(--tinta); font-weight: 600; }
.lista-ics .sin { font-style: italic; }

[data-cat="benjamin"] { --c: var(--c-benjamin); } [data-cat="alevin"] { --c: var(--c-alevin); }
[data-cat="infantil"] { --c: var(--c-infantil); } [data-cat="cadete"] { --c: var(--c-cadete); }
[data-cat="juvenil"]  { --c: var(--c-juvenil); }  [data-cat="junior"] { --c: var(--c-junior); }
[data-cat="senior"]   { --c: var(--c-senior); }   [data-cat="otra"]   { --c: var(--c-otra); }

@media (max-width: 640px) {
  .filtros { position: static; }
  .pista { padding: 20px 18px; }
  .partido { grid-template-columns: 64px 1fr; }
  .hora { font-size: 1.3rem; }
  .condicion { grid-column: 2; justify-self: start; margin-top: 6px; }
  .celda { min-height: 58px; padding: 4px; }
  .mini, .mas { display: none; }
  .puntos { display: flex; }
  .dia-num { font-size: 2.2rem; }
}
@media print {
  .filtros, .acciones, .ayuda-cal, .mes-nav, footer .lista-ics, footer h2, .boton-bus { display: none !important; }
  .solo-impresion { display: block; margin: 6px 0 0; font-weight: 600; }
  body { background: #fff; color: #000; font-size: 12px; }
  .cabecera { background: none; color: #000; padding: 0; }
  .pista { background: none; border: 0; padding: 0 0 8px; }
  .pista::before, .pista::after { display: none; }
  .partido { break-inside: avoid; padding: 6px 8px; }
  .dia { break-inside: avoid-page; margin-top: 14px; }
  .condicion.local, .condicion.derbi { background: none; color: #000; border-color: #000; }
}
</style>
</head>
<body>
<header class="cabecera">
  <div class="envoltura">
    <div class="pista">
      <p class="antetitulo" id="antetitulo">Voleibol</p>
      <h1 id="club"></h1>
      <p class="resumen" id="resumen"></p>
      <p class="solo-impresion" id="filtro-imp"></p>
      <div class="acciones">
        <a class="boton principal oculto" id="enlace-suscribir" href="#">Suscribirse al calendario</a>
        <a class="boton principal" id="enlace-ics" href="#">Añadir al calendario</a>
        <a class="boton" id="enlace-xlsx" href="#">Abrir en Excel</a>
        <button class="boton" type="button" id="imprimir">Imprimir</button>
      </div>
      <details class="ayuda-cal" id="ayuda">
        <summary>Cómo añadirlo al móvil o a Google Calendar</summary>
        <ul class="oculto" id="ayuda-pub">
          <li><b>iPhone, iPad o Mac:</b> toca «Suscribirse al calendario» y acepta. Los cambios llegan solos.</li>
          <li><b>Android o Google Calendar:</b> desde un <b>ordenador</b>, con la cuenta de Google del móvil, abre <a id="enlace-google" href="#" target="_blank" rel="noopener">este enlace de Google Calendar</a> y pulsa «Añadir». Aparecerá también en el móvil. Google vuelve a leer el calendario cuando quiere (puede tardar 12 horas o más): para cambios de última hora, mira esta página.</li>
          <li><b>Outlook:</b> Agregar calendario › Desde Internet, y pega esta dirección: <code id="url-https"></code></li>
          <li>Suscríbete una sola vez: no hace falta repetirlo. Si en vez de suscribirte descargas el .ics y lo importas, es una copia fija que no se actualiza.</li>
          <li>Para un solo equipo, usa sus enlaces al final de la página.</li>
        </ul>
        <ul id="ayuda-local">
          <li><b>Google Calendar:</b> en el ordenador, Configuración › Importar y exportar › Importar, y elige el archivo <span class="nombre-ics"></span>. Mejor en un calendario nuevo solo para el voley.</li>
          <li><b>iPhone:</b> envíate el archivo .ics por correo o WhatsApp y ábrelo; toca «Añadir todo».</li>
          <li><b>Outlook:</b> haz doble clic en el archivo .ics.</li>
          <li>Importar crea una copia fija: si la federación cambia algo, borra ese calendario e impórtalo otra vez.</li>
        </ul>
      </details>
    </div>
  </div>
</header>

<nav class="filtros" aria-label="Filtros">
  <div class="envoltura">
    <div class="equipos-chips" id="chips" role="group" aria-label="Equipos"></div>
    <div class="fila-filtros">
      <div class="segmentado" role="group" aria-label="Vista">
        <button type="button" data-vista="lista">Lista</button><button type="button" data-vista="mes">Mes</button>
      </div>
      <div class="segmentado" role="group" aria-label="Periodo" id="seg-periodo">
        <button type="button" data-per="proximos">Próximos</button><button type="button" data-per="todo">Toda la temporada</button>
      </div>
      <div class="segmentado" role="group" aria-label="Local o visitante">
        <button type="button" data-cond="todos">Todos</button><button type="button" data-cond="local">Local</button><button type="button" data-cond="visitante">Visitante</button>
      </div>
    </div>
  </div>
</nav>

<p class="sr-only" id="estado" role="status" aria-live="polite"></p>
<main class="envoltura" id="contenido"></main>

<footer>
  <div class="envoltura">
    <div id="bloque-equipos">
      <h2>Calendario de cada equipo</h2>
      <ul class="lista-ics" id="lista-ics"></ul>
    </div>
    <p id="pie"></p>
  </div>
</footer>

<script id="datos" type="application/json">__DATOS__</script>
<script>
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('datos').textContent);
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var SEM = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function $(id) { return document.getElementById(id); }
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); }
  function fechaDe(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ahora = new Date();
  var hoy = iso(ahora);
  var horaAhora = dos(ahora.getHours()) + ':' + dos(ahora.getMinutes());
  function conHora(p) { return p.e === 'c' || p.e === 'p'; }
  function yaJugado(p) { return p.f < hoy || (p.f === hoy && conHora(p) && p.h < horaAhora); }

  // Equipos. Nombres cortos: se quita el principio común ("DOMPAVOLEI IF1" -> "IF1").
  var nombres = D.equipos.map(function (e) { return e.n; });
  var conPartidos = D.equipos.filter(function (e) { return e.np > 0; });
  var nombresConPartidos = conPartidos.map(function (e) { return e.n; });
  var prefijo = '';
  if (nombres.length > 1) {
    prefijo = nombres.reduce(function (a, b) { var i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(0, i); });
    prefijo = prefijo.slice(0, prefijo.lastIndexOf(' ') + 1);
    if (prefijo.length < 3 || nombres.some(function (n) { return n.length <= prefijo.length; })) prefijo = '';
  }
  function corto(n) { return prefijo && n.indexOf(prefijo) === 0 ? n.slice(prefijo.length) : n; }

  // Calendario publicado en internet (GitHub Pages): suscripción que se actualiza sola.
  var enWeb = /^https?:$/.test(location.protocol);
  var pub = enWeb
    ? { base: location.protocol + '//' + location.host + location.pathname.replace(/[^\/]*$/, ''), ics: D.ics }
    : (D.pub && D.pub.base ? D.pub : null);
  var esAndroid = /Android/i.test(navigator.userAgent || '');
  function urlHttps(rel) { return pub.base + encodeURI(rel); }
  function urlWebcal(rel) { return urlHttps(rel).replace(/^https?:/, 'webcal:'); }
  function urlGoogle(rel) { return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(urlWebcal(rel)); }

  // Filtros (se recuerdan en este navegador).
  var CLAVE = 'calendario-voley:' + D.club;
  var st = { eq: [], cond: 'todos', per: 'proximos', vista: 'lista', mes: null };
  try {
    var g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    if (g && typeof g === 'object') ['eq', 'cond', 'per', 'vista'].forEach(function (k) { if (g[k] != null) st[k] = g[k]; });
  } catch (e) {}
  if (!Array.isArray(st.eq)) st.eq = [];
  st.eq = st.eq.filter(function (n) { return nombresConPartidos.indexOf(n) >= 0; });
  if (['todos', 'local', 'visitante'].indexOf(st.cond) < 0) st.cond = 'todos';
  if (['proximos', 'todo'].indexOf(st.per) < 0) st.per = 'proximos';
  if (['lista', 'mes'].indexOf(st.vista) < 0) st.vista = 'lista';
  var perElegido = st.per;   // el periodo que eligió la persona (saltar a un día pasado no lo cambia)
  function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify({ eq: st.eq, cond: st.cond, per: perElegido, vista: st.vista })); } catch (e) {} }

  function nuestros(p) { var r = []; if (p.lo) r.push(p.l); if (p.vo) r.push(p.v); return r; }
  function ladoOk(p) {
    // Local/visitante se juzga para los equipos elegidos (en un derbi, cada uno juega de un lado).
    if (st.cond === 'todos') return true;
    var eqs = st.eq.length ? st.eq : null;
    var esL = p.lo && (!eqs || eqs.indexOf(p.l) >= 0);
    var esV = p.vo && (!eqs || eqs.indexOf(p.v) >= 0);
    return st.cond === 'local' ? esL : esV;
  }
  function filtrar(conPeriodo) {
    return D.partidos.filter(function (p) {
      if (conPeriodo && st.per === 'proximos' && p.f < hoy) return false;
      if (st.eq.length && !nuestros(p).some(function (n) { return st.eq.indexOf(n) >= 0; })) return false;
      return ladoOk(p);
    });
  }

  // Cabecera
  document.title = 'Partidos · ' + D.club + ' · ' + D.temporada;
  $('antetitulo').textContent = 'Voleibol · Temporada ' + D.temporada;
  $('club').textContent = D.club;
  var enlIcs = $('enlace-ics'), sus = $('enlace-suscribir'), ayuda = $('ayuda');
  enlIcs.href = encodeURI(D.ics);
  $('enlace-xlsx').href = encodeURI(D.xlsx);
  $('imprimir').addEventListener('click', function () { window.print(); });
  Array.prototype.forEach.call(document.querySelectorAll('.nombre-ics'), function (el) { el.textContent = D.ics; });
  if (pub) {
    enlIcs.textContent = 'Descargar .ics';
    enlIcs.classList.remove('principal');
    if (esAndroid) {
      // Android no abre enlaces webcal: el botón explica cómo hacerlo con Google Calendar.
      sus.textContent = 'Cómo añadirlo al móvil';
      sus.href = '#ayuda';
      sus.addEventListener('click', function (ev) { ev.preventDefault(); ayuda.open = true; ayuda.scrollIntoView({ block: 'nearest' }); });
    } else {
      sus.href = urlWebcal(pub.ics);
    }
    sus.classList.remove('oculto');
    $('enlace-google').href = urlGoogle(pub.ics);
    $('url-https').textContent = urlHttps(pub.ics);
    $('ayuda-pub').classList.remove('oculto');
    $('ayuda-local').classList.add('oculto');
  }
  (function () {
    var total = D.partidos.length;
    var r = $('resumen');
    if (!total) { r.textContent = 'Todavía no hay partidos publicados para esta temporada.'; return; }
    var prox = D.partidos.filter(function (p) { return !yaJugado(p); });
    var txt = '<strong>' + plural(total, 'partido', 'partidos') + '</strong> · <strong>' + plural(conPartidos.length, 'equipo', 'equipos') + '</strong>';
    if (prox.length) {
      var p = prox[0], d = fechaDe(p.f);
      var cuando = p.e === 'x' ? ' (fecha por confirmar)' : !conHora(p) ? '' :
        (D.sal && p.s ? ' · salida ' + p.s + ' (partido ' + p.h + ')' : D.sal && p.casa ? ' · partido ' + p.h + ' (en casa)' : ', ' + p.h);
      txt += ' · Próximo: <strong>' + DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()] + esc(cuando) + '</strong>';
    } else {
      txt += ' · No quedan partidos por jugar';
    }
    r.innerHTML = txt;
  })();

  // Chips de equipos: se crean una vez y luego solo cambia su estado (así no se pierde el foco).
  var chips = $('chips');
  if (conPartidos.length < 2) chips.classList.add('oculto');
  chips.innerHTML = '<button type="button" class="chip todos" data-eq="">Todos los equipos</button>' + conPartidos.map(function (e) {
    return '<button type="button" class="chip" data-cat="' + esc(e.ck) + '" data-eq="' + esc(e.n) + '" title="' + esc(e.n) + '"><span>' +
      esc(corto(e.n)) + '</span> <span class="cat-chip">' + esc(e.cat) + '</span></button>';
  }).join('');
  function marcarChips() {
    Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (b) {
      var n = b.getAttribute('data-eq');
      b.setAttribute('aria-pressed', String(n ? st.eq.indexOf(n) >= 0 : st.eq.length === 0));
    });
  }
  chips.addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip'); if (!b) return;
    var n = b.getAttribute('data-eq');
    if (!n) st.eq = [];
    else { var i = st.eq.indexOf(n); if (i >= 0) st.eq.splice(i, 1); else st.eq.push(n); }
    guardar(); marcarChips(); pintar();
  });
  document.querySelector('.filtros').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || b.classList.contains('chip')) return;
    if (b.dataset.vista) st.vista = b.dataset.vista;
    if (b.dataset.per) st.per = perElegido = b.dataset.per;
    if (b.dataset.cond) st.cond = b.dataset.cond;
    guardar(); pintar();
  });

  function marcarSegmentos() {
    Array.prototype.forEach.call(document.querySelectorAll('.segmentado button'), function (b) {
      var on = (b.dataset.vista && b.dataset.vista === st.vista) || (b.dataset.per && b.dataset.per === st.per) || (b.dataset.cond && b.dataset.cond === st.cond);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('seg-periodo').classList.toggle('oculto', st.vista === 'mes');
  }

  var main = $('contenido');

  function vacio(msg, boton) {
    return '<div class="vacio"><p>' + esc(msg) + '</p>' + (boton ? '<button type="button" class="boton claro" id="quitar">' + esc(boton) + '</button>' : '') + '</div>';
  }

  function duracion(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }
  // Hora a la que empieza el día del equipo: salida en bus, calentamiento en casa o la del partido.
  function horaInicio(p) {
    if (!conHora(p)) return '';
    if (D.sal && !p.seg) return p.s || p.ca || p.h;
    return p.h;
  }
  function textoHora(p) {
    if (p.e === 'x') return '<div class="hora pendiente">Fecha y hora por confirmar</div>';
    if (p.e === 'h') return '<div class="hora pendiente">Hora por confirmar</div>';
    var prov = p.e === 'p' ? '<small>Provisional</small>' : '';
    if (!D.sal) return '<div class="hora">' + esc(p.h) + prov + '</div>';
    if (p.seg) return '<div class="hora"><span class="etq">2º partido</span>' + esc(p.h) + prov + '</div>';
    var etq = p.s ? 'Salida' : 'Calentam.';
    return '<div class="hora"><span class="etq' + (p.s ? ' bus' : '') + '">' + etq + '</span>' + esc(p.s || p.ca) +
      '<small class="partido-h">Partido ' + esc(p.h) + '</small>' + prov + '</div>';
  }
  function textoViaje(p) {
    if (!D.sal || !conHora(p)) return '';
    var t;
    if (p.seg) t = 'Se va con el partido anterior' + (p.sp ? ' (salida ' + p.sp + ')' : '');
    else if (p.casa) t = 'En casa · calentamiento ' + p.ca;
    else if (p.s) t = '🚌 ' + duracion(p.vj) + ' en bus' + (p.mun ? ' hasta ' + p.mun : '') + ' · calentamiento ' + p.ca;
    else t = 'Viaje sin calcular · calentamiento ' + p.ca;
    return '<div class="viaje">' + esc(t) + '</div>';
  }

  // Botón "Pedir bus": abre el correo con la petición ya redactada para la empresa de autobuses.
  function hm(min) { return dos(Math.floor(min / 60) % 24) + ':' + dos(min % 60); }
  function aMin(h) { var t = h.split(':'); return +t[0] * 60 + +t[1]; }
  function mismoEquipo(a, b) { return nuestros(a).join('/') === nuestros(b).join('/'); }
  function enlaceBus(p) {
    if (!D.bus || !p.s || yaJugado(p)) return '';
    var grupo = D.partidos.filter(function (x) { return x.f === p.f && x.pab === p.pab && conHora(x) && mismoEquipo(x, p); });
    var ult = grupo[grupo.length - 1];
    var d = fechaDe(p.f);
    var fecha = DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear();
    var equipo = nuestros(p).join(' y ');
    var fin = aMin(ult.h) + (D.bus.dur || 120);
    var llegada = Math.ceil((fin + (p.vj || 0)) / 15) * 15;
    var info = (D.pabs && D.pabs[p.pab]) || {};
    var destino = p.pab + (info.dir ? ' (' + info.dir + ')' : (p.mun ? ' (' + p.mun + ')' : ''));
    var partidos = grupo.map(function (x) { return x.h + ' contra ' + (x.lo && x.vo ? 'otro equipo del club' : x.lo ? x.v : x.l); });
    var l = [
      'Hola:', '',
      'Queremos pedir un autobús para el equipo ' + equipo + ' (' + p.cat + '):', '',
      '- Día: ' + fecha,
      '- Salida: a las ' + p.s + ' desde ' + D.bus.origen + (D.bus.dirOrigen ? ' (' + D.bus.dirOrigen + ')' : ''),
      '- Destino: ' + destino,
      '- ' + (grupo.length > 1 ? 'Partidos: ' : 'Partido: ') + partidos.join('; '),
      '- Regreso: al terminar' + (grupo.length > 1 ? ' el último partido' : ' el partido') + ', hacia las ' + hm(fin) +
        '; llegada aproximada a ' + D.bus.origen + ' a las ' + hm(llegada),
      '- Plazas: ' + (D.bus.plazas || '__')
    ];
    D.partidos.forEach(function (o) {
      if (o !== p && o.f === p.f && o.pab === p.pab && o.s && !mismoEquipo(o, p)) {
        l.push('', 'Ese día también viaja ' + nuestros(o).join(' y ') + ' al mismo pabellón (salida ' + o.s + '): se podría compartir el autobús.');
      }
    });
    l.push('', 'Muchas gracias.');
    if (D.bus.firma) l.push(D.bus.firma);
    var asunto = 'Autobús ' + equipo + ' · ' + DIAS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1) + ' · salida ' + p.s;
    var para = (D.bus.para || '').split(/[,;]\s*/).filter(Boolean).map(encodeURIComponent).join(',');
    var q = [];
    if (D.bus.cc) q.push('cc=' + D.bus.cc.split(/[,;]\s*/).filter(Boolean).map(encodeURIComponent).join(','));
    q.push('subject=' + encodeURIComponent(asunto));
    q.push('body=' + encodeURIComponent(l.join('\n').replace(/\n/g, '\r\n')));
    return '<a class="boton-bus" href="' + esc('mailto:' + para + '?' + q.join('&')) + '">✉ Pedir bus</a>';
  }

  function tarjeta(p, proximo) {
    var l = p.lo ? '<span>' + esc(p.l) + '</span>' : '<span class="rival">' + esc(p.l) + '</span>';
    var v = p.vo ? '<span>' + esc(p.v) + '</span>' : '<span class="rival">' + esc(p.v) + '</span>';
    var cond = p.cond === 'local' ? 'Local' : p.cond === 'visitante' ? 'Visitante' : 'Derbi';
    var pab = p.pab
      ? '<a href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(p.pab + ', ' + (p.mun || 'Galicia')) + '" target="_blank" rel="noopener">' + esc(p.pab) + '</a>'
      : 'Pabellón por confirmar';
    return '<article class="partido" data-cat="' + esc(p.ck) + '">' + textoHora(p) +
      '<div><div class="categoria">' + esc(p.cat) + (proximo ? '<span class="proximo-marca">Próximo</span>' : '') + '</div>' +
      '<div class="equipos">' + l + '<span class="vs">vs</span>' + v + '</div>' + textoViaje(p) +
      '<div class="detalle">' + esc(p.comp) + ' · ' + pab + '</div>' + enlaceBus(p) + '</div>' +
      '<span class="condicion ' + esc(p.cond) + '">' + cond + '</span></article>';
  }

  function pintarLista() {
    var lista = filtrar(true);
    if (!D.partidos.length) {
      main.innerHTML = vacio('Todavía no hay partidos publicados para esta temporada. La federación los va publicando poco a poco.');
      return 0;
    }
    if (!lista.length) {
      var soloPeriodo = !st.eq.length && st.cond === 'todos' && st.per === 'proximos';
      main.innerHTML = soloPeriodo
        ? vacio('No quedan partidos por jugar esta temporada.', 'Ver toda la temporada')
        : vacio('No hay partidos con estos filtros.', 'Ver todos los partidos');
      return 0;
    }
    var proximo = null;
    for (var i = 0; i < lista.length; i++) { if (!yaJugado(lista[i])) { proximo = lista[i]; break; } }
    var html = '', actual = null;
    lista.forEach(function (p) {
      if (p.f !== actual) {
        if (actual) html += '</section>';
        actual = p.f;
        var d = fechaDe(p.f), n = lista.filter(function (x) { return x.f === p.f; }).length;
        var nombre = p.f === hoy ? 'Hoy' : DIAS[d.getDay()];
        html += '<section class="dia' + (p.f < hoy ? ' pasado' : '') + '" id="d-' + p.f + '"><h2 class="dia-cabecera" tabindex="-1">' +
          '<span class="dia-num">' + d.getDate() + '</span><span class="dia-nombre">' + nombre + '</span>' +
          '<span class="dia-mes">' + MESES[d.getMonth()] + (d.getFullYear() !== ahora.getFullYear() ? ' ' + d.getFullYear() : '') + '</span>' +
          '<span class="dia-cuenta">' + plural(n, 'partido', 'partidos') + '</span></h2>';
      }
      html += tarjeta(p, p === proximo);
    });
    main.innerHTML = html + '</section>';
    return lista.length;
  }

  function pintarMes() {
    var lista = filtrar(false);
    if (!lista.length) {
      main.innerHTML = D.partidos.length ? vacio('No hay partidos con estos filtros.', 'Ver todos los partidos') : vacio('Todavía no hay partidos publicados para esta temporada.');
      return 0;
    }
    var meses = lista.map(function (p) { return p.f.slice(0, 7); }).filter(function (m, i, a) { return a.indexOf(m) === i; }).sort();
    var min = meses[0], max = meses[meses.length - 1];
    if (!st.mes || st.mes < min || st.mes > max) {
      st.mes = meses.filter(function (m) { return m >= hoy.slice(0, 7); })[0] || max;
    }
    var y = +st.mes.slice(0, 4), m = +st.mes.slice(5, 7) - 1;
    var desplaz = (new Date(y, m, 1).getDay() + 6) % 7;
    var inicio = new Date(y, m, 1 - desplaz);
    var celdas = Math.ceil((desplaz + new Date(y, m + 1, 0).getDate()) / 7) * 7;
    var porDia = {};
    lista.forEach(function (p) { (porDia[p.f] = porDia[p.f] || []).push(p); });
    var enMes = lista.filter(function (p) { return p.f.slice(0, 7) === st.mes; }).length;
    var html = '<div class="mes-barra"><h2 class="mes-titulo">' + MESES[m] + ' ' + y + '</h2><div class="mes-nav">' +
      '<button type="button" id="mes-ant" aria-label="Mes anterior"' + (st.mes <= min ? ' disabled' : '') + '>‹</button>' +
      '<button type="button" id="mes-sig" aria-label="Mes siguiente"' + (st.mes >= max ? ' disabled' : '') + '>›</button></div></div>';
    html += '<div class="rejilla">' + SEM.map(function (s) { return '<div class="sem">' + s + '</div>'; }).join('');
    for (var i = 0; i < celdas; i++) {
      var d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
      var f = iso(d), ps = porDia[f] || [];
      var cls = 'celda' + (d.getMonth() !== m ? ' fuera-mes' : '') + (f === hoy ? ' hoy' : '') + (ps.length ? ' con-partidos' : '');
      html += '<div class="' + cls + '"' + (ps.length ? ' data-ir="' + f + '" role="button" tabindex="0" aria-label="' + d.getDate() + ' de ' + MESES[d.getMonth()] + ': ' + plural(ps.length, 'partido', 'partidos') + '"' : '') + '>' +
        '<span class="num">' + d.getDate() + '</span>';
      ps.slice(0, 4).forEach(function (p) {
        html += '<span class="mini" data-cat="' + esc(p.ck) + '" title="' + esc(p.cat + ' · ' + p.l + ' vs ' + p.v + (conHora(p) ? ' · partido ' + p.h : '')) + '"><b>' +
          (conHora(p) ? (p.s ? '🚌' : '') + esc(horaInicio(p)) : '¿?') + '</b> ' +
          esc(nuestros(p).map(corto).join(' / ')) + '</span>';
      });
      if (ps.length > 4) html += '<span class="mas">+' + (ps.length - 4) + ' más</span>';
      if (ps.length) html += '<span class="puntos">' + ps.map(function (p) { return '<i data-cat="' + esc(p.ck) + '"></i>'; }).join('') + '</span>';
      html += '</div>';
    }
    main.innerHTML = html + '</div>';
    function mover(delta, id) {
      var nd = new Date(y, m + delta, 1);
      st.mes = nd.getFullYear() + '-' + dos(nd.getMonth() + 1);
      pintar(id);
    }
    var a = $('mes-ant'), s = $('mes-sig');
    if (a) a.onclick = function () { mover(-1, 'mes-ant'); };
    if (s) s.onclick = function () { mover(1, 'mes-sig'); };
    return enMes;
  }

  function anunciar(n) {
    var partes = [st.eq.length ? 'Equipos: ' + st.eq.map(corto).join(', ') : 'Todos los equipos'];
    if (st.vista === 'lista') partes.push(st.per === 'proximos' ? 'próximos partidos' : 'toda la temporada');
    if (st.cond !== 'todos') partes.push(st.cond === 'local' ? 'solo como local' : 'solo como visitante');
    $('estado').textContent = plural(n, 'partido', 'partidos') + ' · ' + partes.join(' · ');
    $('filtro-imp').textContent = partes.join(' · ') + ' · actualizado el ' + D.generado;
  }

  function irADia(f) {
    st.vista = 'lista';
    if (f < hoy) st.per = 'todo';   // solo para esta visita: no se guarda como preferencia
    guardar(); pintar();
    var el = $('d-' + f);
    if (!el) return;
    var barra = document.querySelector('.filtros');
    var tapa = getComputedStyle(barra).position === 'sticky' ? barra.offsetHeight : 0;
    window.scrollTo(0, el.getBoundingClientRect().top + window.pageYOffset - tapa - 8);
    var h = el.querySelector('.dia-cabecera');
    if (h) h.focus({ preventScroll: true });
  }
  main.addEventListener('click', function (ev) {
    if (ev.target.id === 'quitar') {
      st.eq = []; st.cond = 'todos'; st.per = perElegido = 'todo';
      guardar(); marcarChips(); pintar(); return;
    }
    var c = ev.target.closest('[data-ir]'); if (c) irADia(c.getAttribute('data-ir'));
  });
  main.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var c = ev.target.closest('[data-ir]'); if (c) { ev.preventDefault(); irADia(c.getAttribute('data-ir')); }
  });

  function pintar(foco) {
    marcarSegmentos();
    var n = st.vista === 'mes' ? pintarMes() : pintarLista();
    anunciar(n);
    if (foco) { var el = $(foco); if (el && !el.disabled) el.focus(); }
  }

  // Pie: calendario de cada equipo
  var li = D.equipos.filter(function (e) { return e.ics; }).map(function (e) {
    var cab = '<b>' + esc(e.n) + '</b> · ' + esc(e.cat) + (e.np ? '' : ' <span class="sin">(aún sin partidos publicados)</span>');
    if (pub) {
      return '<li>' + cab + '<br><a href="' + esc(urlWebcal(e.ics)) + '">iPhone / Outlook</a> · <a href="' + esc(urlGoogle(e.ics)) +
        '" target="_blank" rel="noopener">Google Calendar</a> · <a href="' + esc(urlHttps(e.ics)) + '">dirección</a></li>';
    }
    return '<li>' + cab + ' · <a href="' + esc(encodeURI(e.ics)) + '">archivo .ics</a></li>';
  });
  if (li.length) $('lista-ics').innerHTML = li.join('');
  else $('bloque-equipos').classList.add('oculto');
  $('pie').textContent = 'Datos de la Federación Galega de Voleibol (volei.gal · iSquad), actualizados el ' + D.generado + '. ' +
    (enWeb ? 'Esta página se actualiza sola cada hora; los horarios pueden cambiar.' : 'Los horarios pueden cambiar: vuelve a generar el calendario antes de cada fin de semana.') +
    ' Solo aparecen los partidos que publica la federación gallega.' +
    (D.sal ? ' Horas de salida desde ' + D.sal.origen + ': partido menos ' + D.sal.cal + ' min de calentamiento y el viaje en bus (tiempo por carretera de OpenStreetMap/OSRM, redondeado al alza).' : '');

  marcarChips();
  pintar();
})();
</script>
</body>
</html>
'@

function New-Html($Partidos, $Equipos, [string]$NombreClub, [string]$Temp, [string]$Ics, [string]$Xlsx, [datetime]$Generado, [string]$UrlPublicada, $Salidas, $Pabellones, $PedirBus, [int]$Duracion) {
    $estado = @{ confirmada = 'c'; provisional = 'p'; sinhora = 'h'; pendiente = 'x' }
    $hm = { param($f) if ($f) { ([datetime]$f).ToString('HH:mm', $Script:Inv) } else { '' } }
    # Dirección y municipio de cada pabellón (para el correo de "Pedir bus").
    $pabs = [ordered]@{}
    if ($Pabellones) {
        foreach ($n in @($Partidos | ForEach-Object { $_.Pabellon } | Where-Object { $_ } | Sort-Object -Unique)) {
            $e = $Pabellones[$n]
            if ($e -and $null -ne $e.lat) { $pabs[$n] = [ordered]@{ dir = [string]$e.direccion; mun = [string]$e.municipio } }
        }
    }
    $bus = $null
    if ($PedirBus) { $bus = [ordered]@{}; foreach ($k in $PedirBus.Keys) { $bus[$k] = $PedirBus[$k] }; $bus.dur = $Duracion }
    $pub = $null
    if ($UrlPublicada -match '^(https?://.+/)([^/]+\.ics)$') { $pub = [ordered]@{ base = $Matches[1]; ics = $Matches[2] } }
    $datos = [ordered]@{
        club      = $NombreClub
        temporada = $Temp
        generado  = $Generado.ToString('dd/MM/yyyy HH:mm', $Script:Inv)
        ics       = $Ics
        xlsx      = $Xlsx
        pub       = $pub
        sal       = $(if ($Salidas) { [ordered]@{ origen = $Salidas.Origen; cal = $Salidas.Calentamiento } } else { $null })
        bus       = $bus
        pabs      = $pabs
        equipos   = @($Equipos | ForEach-Object {
            [ordered]@{ n = $_.Nombre; cat = $_.Categoria; ck = $_.ClaveCategoria; ics = $_.Ics; np = @($_.Partidos).Count }
        })
        partidos  = @($Partidos | ForEach-Object {
            [ordered]@{
                f    = $_.Fecha.ToString('yyyy-MM-dd', $Script:Inv)
                h    = $(if (Test-ConHora $_) { $_.Fecha.ToString('HH:mm', $Script:Inv) } else { '' })
                e    = $estado[$_.Estado]
                cat  = $_.Categoria
                ck   = $_.ClaveCategoria
                comp = $_.Competicion
                l    = $_.Local
                v    = $_.Visitante
                lo   = [bool]$_.EsLocal
                vo   = [bool]$_.EsVisitante
                pab  = $_.Pabellon
                cond = $_.Condicion
                s    = (& $hm $_.Salida)
                ca   = $(if ($_.Segundo) { '' } else { & $hm $_.Calentamiento })
                vj   = $(if ($null -ne $_.ViajeMin -and -not $_.Segundo) { [int]$_.ViajeMin } else { 0 })
                casa = [bool]$_.EnCasa
                seg  = [bool]$_.Segundo
                sp   = $(if ($_.SalidaPrimero) { & $hm $_.SalidaPrimero.Salida } else { '' })
                mun  = [string]$_.Municipio
            }
        })
    }
    $json = ConvertTo-Json -InputObject $datos -Depth 6 -Compress
    # Dentro de <script> no puede aparecer "</script>" ni "<!--": cada "<" se escribe con su escape JSON
    # (barra invertida + u003c). Se construye por partes a propósito para que ningún editor lo convierta en "<".
    $escapeMenor = ([string][char]92) + 'u003c'
    $json = $json.Replace('<', $escapeMenor)
    if ($json.IndexOf('<') -ge 0) { throw 'Error interno: quedan "<" sin escapar en los datos de la página.' }
    $titulo = [Net.WebUtility]::HtmlEncode("Partidos · $NombreClub · $Temp")
    return $Script:PlantillaHtml.Replace('__TITULO__', $titulo).Replace('__DATOS__', $json)
}

# --- Programa principal ------------------------------------------------------------------------

function Get-FechaParametro([string]$Valor, [string]$Nombre) {
    $d = [datetime]::MinValue
    foreach ($formato in @('yyyy-MM-dd', 'dd/MM/yyyy', 'd/M/yyyy')) {
        if ([datetime]::TryParseExact($Valor.Trim(), $formato, $Script:Inv, [Globalization.DateTimeStyles]::None, [ref]$d)) { return $d }
    }
    throw "Fecha «$Nombre» no válida: «$Valor». Usa el formato aaaa-mm-dd."
}

function New-RangoTemporada([int]$Anio) {
    $inicio = New-Object DateTime($Anio, 8, 1)
    $fin = New-Object DateTime(($Anio + 1), 7, 31)
    return [pscustomobject]@{
        Anio = $Anio; Inicio = $inicio; Fin = $fin
        Etiqueta = ('{0}/{1:00}' -f $Anio, (($Anio + 1) % 100))
        Parcial = $false; Explicito = $false
    }
}

function Get-RangoTemporada {
    $dDesde = if ($Desde) { Get-FechaParametro $Desde 'Desde' } else { $null }
    $dHasta = if ($Hasta) { Get-FechaParametro $Hasta 'Hasta' } else { $null }
    if ($Temporada) {
        if ($Temporada -notmatch '^\s*(\d{4})\s*(?:[-/]\s*(\d{2}|\d{4}))?\s*$') { throw "Temporada no válida: «$Temporada». Usa el formato 2026-27." }
        $anio = [int]$Matches[1]
        if ($Matches[2] -and ([int]$Matches[2] % 100) -ne (($anio + 1) % 100)) { throw "Temporada no válida: «$Temporada». El segundo año tiene que ser el siguiente (p. ej. 2026-27)." }
        if ($anio -lt 2000 -or $anio -gt 2100) { throw "Temporada no válida: «$Temporada»." }
    } elseif ($dDesde) { $anio = Get-AnioTemporada $dDesde }
    elseif ($dHasta) { $anio = Get-AnioTemporada $dHasta }
    else { $anio = Get-AnioTemporada (Get-Date) }

    $rango = New-RangoTemporada $anio
    $rango.Explicito = [bool]($Temporada -or $Desde -or $Hasta)
    $temporadaIni = $rango.Inicio; $temporadaFin = $rango.Fin
    if ($dDesde) { $rango.Inicio = $dDesde; $rango.Parcial = $true }
    if ($dHasta) { $rango.Fin = $dHasta; $rango.Parcial = $true }
    if ($rango.Inicio -lt $temporadaIni -or $rango.Fin -gt $temporadaFin) {
        throw ("Las fechas tienen que estar dentro de la temporada {0} (del {1} al {2})." -f $rango.Etiqueta,
            $temporadaIni.ToString('dd/MM/yyyy', $Script:Inv), $temporadaFin.ToString('dd/MM/yyyy', $Script:Inv))
    }
    if ($rango.Fin -lt $rango.Inicio) {
        throw ("La fecha final ({0}) es anterior a la inicial ({1})." -f $rango.Fin.ToString('dd/MM/yyyy', $Script:Inv), $rango.Inicio.ToString('dd/MM/yyyy', $Script:Inv))
    }
    return $rango
}

function Invoke-Principal {
    $generado = Get-Date
    $rango = Get-RangoTemporada
    $cfg = Read-Config

    Write-Host ''
    Write-Host "  CALENDARIO DE VOLEIBOL · temporada $($rango.Etiqueta)" -ForegroundColor Cyan
    Write-Paso 'Descargando partidos de volei.gal...'
    # Se descarga también la temporada anterior: sirve para conocer todos los equipos del club y para
    # no quedarse vacío en verano, antes de que la federación publique la temporada nueva.
    $crudos = @(Get-PartidosApi (New-Object DateTime(($rango.Anio - 1), 8, 1)))
    if ($crudos.Count -eq 0) {
        throw 'La federación no ha devuelto ningún partido (ni de esta temporada ni de la anterior). Puede ser un fallo temporal de su web: inténtalo más tarde. No se ha cambiado ningún archivo.'
    }
    $iniTxt = (New-Object DateTime($rango.Anio, 8, 1)).ToString('yyyy-MM-dd', $Script:Inv)
    $finTxt = (New-Object DateTime(($rango.Anio + 1), 7, 31)).ToString('yyyy-MM-dd', $Script:Inv)
    $deTemporada = @($crudos | Where-Object {
        $f = Get-FechaCruda $_
        $f -and [string]::CompareOrdinal($f, $iniTxt) -ge 0 -and [string]::CompareOrdinal($f, $finTxt) -le 0
    })
    Write-Paso ('{0} partidos publicados en Galicia en la temporada {1}.' -f $deTemporada.Count, $rango.Etiqueta)

    if ($ListarClubs) {
        Show-Catalogo @(Get-CatalogoClubs $deTemporada $crudos) $rango.Etiqueta
        return
    }

    $clubs = @(Resolve-Clubs $deTemporada $crudos $rango.Etiqueta $cfg)
    if (-not $clubs.Count) { throw 'No se ha elegido ningún club.' }
    $ids = New-Object 'Collections.Generic.HashSet[string]'
    foreach ($c in $clubs) { [void]$ids.Add([string]$c.Id) }
    $nombreClub = ($clubs | ForEach-Object { $_.Nombre }) -join ' + '

    $idsConPartidos = New-Object 'Collections.Generic.HashSet[string]'
    foreach ($r in $crudos) { [void]$idsConPartidos.Add([string]$r.id_club_local); [void]$idsConPartidos.Add([string]$r.id_club_visitante) }
    foreach ($c in $clubs) {
        if (-not $idsConPartidos.Contains([string]$c.Id)) {
            Write-Aviso "El club con ID $($c.Id) ($($c.Nombre)) no aparece en ningún partido de esta temporada ni de la anterior. Revisa el ID en config.json (-ListarClubs muestra los clubs)."
        }
    }

    $duracion = if ($DuracionMinutos -gt 0) { $DuracionMinutos } else { Get-DuracionConfig $cfg }
    $urlPublicada = if ($cfg -and $cfg.calendario_publicado) { [string]$cfg.calendario_publicado } else { '' }

    $todos = @(ConvertTo-Partidos $crudos $ids)
    $partidos = @($todos | Where-Object { $_.Fecha.Date -ge $rango.Inicio.Date -and $_.Fecha.Date -le $rango.Fin.Date })
    $anteriores = @($todos | Where-Object { $_.Temporada -eq ($rango.Anio - 1) })
    if (-not $rango.Explicito -and $partidos.Count -eq 0 -and $anteriores.Count -gt 0) {
        Write-Aviso "Todavía no hay partidos de $nombreClub publicados para la temporada $($rango.Etiqueta)."
        $rango = New-RangoTemporada ($rango.Anio - 1)
        Write-Paso "Mientras tanto se genera el calendario de la temporada $($rango.Etiqueta)."
        $partidos = $anteriores
        $anteriores = @()
    }
    $equipos = @(Get-Equipos $partidos $anteriores)

    # Horas de salida (si config.json tiene "salidas")
    $salidas = Get-ConfigSalidas $cfg
    $pabellones = $null
    if ($salidas -and $partidos.Count) {
        Write-Paso "Calculando horas de salida desde $($salidas.Origen)..."
        $pabellones = Resolve-Pabellones $partidos $salidas (New-Object DateTime(($rango.Anio - 1), 8, 1))
        Add-Salidas $partidos $pabellones $salidas
        $sinCalcular = @($partidos | Where-Object { (Test-ConHora $_) -and -not $_.EnCasa -and -not $_.Segundo -and $null -eq $_.ViajeMin } |
            ForEach-Object { if ($_.Pabellon) { $_.Pabellon } else { '(sin pabellón)' } } | Sort-Object -Unique)
        if ($sinCalcular.Count) {
            Write-Aviso ('Sin tiempo de viaje para: ' + ($sinCalcular -join '; ') + '. Se puede poner a mano en config.json (salidas > tiempos_viaje_minutos).')
        }
    }

    # Carpeta y nombres de archivo
    $carpetaSalida = if ($Salida) { Resolve-Ruta $Salida } else { Join-Path $Script:Carpeta 'calendario' }
    [void](New-Item -ItemType Directory -Force -Path $carpetaSalida)
    $etiquetaArchivo = $rango.Etiqueta.Replace('/', '-')
    if ($NombreBase) {
        $base = Get-Slug $NombreBase
    } else {
        $base = 'calendario-' + (Get-Slug ($clubs[0].Nombre)) + $(if ($clubs.Count -gt 1) { '-y-otros' } else { '' }) + "-$etiquetaArchivo"
        if ($rango.Parcial) { $base += '-' + $rango.Inicio.ToString('yyyyMMdd', $Script:Inv) + '-' + $rango.Fin.ToString('yyyyMMdd', $Script:Inv) }
    }
    $descripcion = "Partidos de $nombreClub (todas las categorías), temporada $($rango.Etiqueta). Fuente: Federación Galega de Voleibol."

    # Un .ics por equipo (también para los equipos que aún no tienen partidos publicados)
    $conEquipos = -not $SinEquipos -and -not $rango.Parcial -and $equipos.Count -gt 0
    if ($conEquipos) {
        $carpetaEquipos = Join-Path $carpetaSalida 'equipos'
        [void](New-Item -ItemType Directory -Force -Path $carpetaEquipos)
        $usados = @{}
        foreach ($e in $equipos) {
            $slug = Get-Slug $e.Nombre
            if ($usados.ContainsKey($slug)) { $slug = "$slug-$(Get-Slug $e.Categoria)" }
            $usados[$slug] = $true
            $contenido = New-Ics $e.Partidos "Voleibol · $($e.Nombre)" "Partidos de $($e.Nombre) ($($e.Categoria)), temporada $($rango.Etiqueta). Fuente: Federación Galega de Voleibol." $duracion $generado $salidas
            $ruta = Save-Texto (Join-Path $carpetaEquipos "$slug.ics") $contenido
            $e.Ics = 'equipos/' + (Split-Path $ruta -Leaf)
        }
    }

    $rutaIcs = Save-Texto (Join-Path $carpetaSalida "$base.ics") (New-Ics $partidos "Voleibol · $nombreClub" $descripcion $duracion $generado $salidas)
    $rutaXlsx = Save-Xlsx $partidos (Join-Path $carpetaSalida "$base.xlsx") $generado $nombreClub $salidas
    $html = New-Html $partidos $equipos $nombreClub $rango.Etiqueta (Split-Path $rutaIcs -Leaf) (Split-Path $rutaXlsx -Leaf) $generado $urlPublicada `
        $salidas $pabellones (Get-ConfigPedirBus $cfg $salidas) $duracion
    $rutaHtml = Save-Texto (Join-Path $carpetaSalida "$base.html") $html
    if ($Historial) { Save-Historial $partidos (Resolve-Ruta $Historial) $nombreClub $rango.Etiqueta }

    # Resumen en pantalla
    $hoy = (Get-Date).Date
    $proximos = @($partidos | Where-Object { $_.Fecha -ge $hoy })
    $conPartidos = @($equipos | Where-Object { @($_.Partidos).Count -gt 0 }).Count
    Write-Host ''
    Write-Host "  $nombreClub" -ForegroundColor White
    if (-not $partidos.Count) {
        if ($rango.Parcial) {
            Write-Aviso ('No hay partidos de este club entre el {0} y el {1}.' -f $rango.Inicio.ToString('dd/MM/yyyy', $Script:Inv), $rango.Fin.ToString('dd/MM/yyyy', $Script:Inv))
        } else {
            Write-Aviso "Todavía no hay partidos publicados de este club para la temporada $($rango.Etiqueta)."
            Write-Paso 'La federación los va publicando poco a poco: vuelve a ejecutarlo más adelante.'
        }
    } else {
        Write-Paso ("{0} partidos ({1} por jugar) de {2} equipos." -f $partidos.Count, $proximos.Count, $conPartidos)
        $pendientes = @($proximos | Where-Object { $_.Estado -ne 'confirmada' }).Count
        if ($pendientes) { Write-Paso "$pendientes partido(s) con la fecha o la hora aún sin confirmar." }
        if ($proximos.Count) {
            Write-Host ''
            Write-Host '  Próximos partidos:' -ForegroundColor Cyan
            foreach ($p in ($proximos | Select-Object -First 12)) {
                $hora = if (Test-ConHora $p) { $p.Fecha.ToString('HH:mm', $Script:Inv) } else { '--:--' }
                $sal = ''
                if ($salidas) {
                    $t = Get-TextoSalida $p
                    $sal = if ($p.Salida) { "salida $t" } elseif ($p.EnCasa) { 'en casa' } else { $t.ToLowerInvariant() }
                }
                Write-Host ('  {0,-10} {1,-6} {2,-13} {3,-12} {4} - {5}' -f (Format-FechaCorta $p.Fecha), $hora, $sal, $p.Categoria, $p.Local, $p.Visitante)
            }
            if ($proximos.Count -gt 12) { Write-Paso "... y $($proximos.Count - 12) más (míralos en la página HTML)." }
        }
    }
    $sinPartidos = @($equipos | Where-Object { @($_.Partidos).Count -eq 0 })
    if ($sinPartidos.Count -and $conEquipos) {
        Write-Paso ('Equipos aún sin partidos publicados: ' + (($sinPartidos | ForEach-Object { $_.Nombre }) -join ', ') + '.')
    }

    $sep = [IO.Path]::DirectorySeparatorChar
    Write-Host ''
    Write-Host "  Archivos generados en: $carpetaSalida" -ForegroundColor Green
    Write-Host "    $(Split-Path $rutaHtml -Leaf)  <- abrir en el navegador (lista, mes, imprimir)"
    Write-Host "    $(Split-Path $rutaIcs -Leaf)   <- calendario para importar (copia fija)"
    Write-Host "    $(Split-Path $rutaXlsx -Leaf)  <- Excel"
    if ($conEquipos) { Write-Host "    equipos$sep  <- un calendario .ics por equipo ($($equipos.Count))" }
    if ($urlPublicada) {
        Write-Host ''
        Write-Host "  Calendario en internet (se actualiza solo): $urlPublicada" -ForegroundColor Green
    }

    if ($Abrir -and $env:OS -eq 'Windows_NT') {
        try { Invoke-Item -LiteralPath $rutaHtml } catch { Write-Aviso 'No se pudo abrir la página automáticamente.' }
    }
}

try {
    Invoke-Principal
} catch {
    Write-Host ''
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($VerbosePreference -eq 'Continue') { Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray }
    exit 1
}
