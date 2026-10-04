param(
    [string]$StateDir,
    [string]$DbPath,
    [int]$OwnerPid,
    [string]$ArmId,
    [long]$ExpiresAt,
    [string]$HandshakeFile
)

# Early PS5.1 required args validation: fail closed before any handshake or side-effects
if ([string]::IsNullOrWhiteSpace($StateDir) -or
    [string]::IsNullOrWhiteSpace($DbPath) -or
    $OwnerPid -le 0 -or
    [string]::IsNullOrWhiteSpace($ArmId) -or
    $ExpiresAt -le 0 -or
    [string]::IsNullOrWhiteSpace($HandshakeFile)) {
    Write-Error "Faltan argumentos requeridos o son invalidos para maintenance-monitor.ps1."
    exit 1
}

# Set UTF-8 output encoding for proper display of Spanish characters
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

# Verify real visible interactive console capability before acknowledging handshake.
# If invoked in mere background or detached without an active console, fail closed.
$consoleReady = $false
try {
    if ($Host.UI.RawUI -and
        $Host.UI.RawUI.WindowSize.Width -gt 0 -and
        $Host.UI.RawUI.WindowSize.Height -gt 0) {
        $consoleReady = $true
    }
} catch {}

if (!$consoleReady) {
    Write-Error "El monitor requiere una consola visible e interactiva. Inicializacion cancelada."
    exit 1
}

try {
    $Host.UI.RawUI.WindowTitle = '[ESPERANDO CIERRE] Cierre OpenCode normalmente'
} catch {}

# 1. Readiness handshake acknowledgment ONLY after successful console readiness
try {
    $hs = @{
        ready = $true
        monitorPid = $PID
        armId = $ArmId
        startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($HandshakeFile, $hs, $utf8NoBom)
} catch {}

$armedFile     = Join-Path $StateDir "armed-plan.json"
$claimedFile   = Join-Path $StateDir "claimed-plan.json"
$receiptFile   = Join-Path $StateDir "maintenance-receipt.json"
$workerPidFile = Join-Path $StateDir "worker-pid-$ArmId.json"

function Get-WorkerPid {
    if (Test-Path -LiteralPath $workerPidFile) {
        try {
            $raw = [System.IO.File]::ReadAllText($workerPidFile, [System.Text.Encoding]::UTF8)
            $obj = ConvertFrom-Json $raw
            if ($obj.workerPid) { return [int]$obj.workerPid }
        } catch {}
    }
    if (Test-Path -LiteralPath $armedFile) {
        try {
            $raw = [System.IO.File]::ReadAllText($armedFile, [System.Text.Encoding]::UTF8)
            $obj = ConvertFrom-Json $raw
            if ($obj.id -eq $ArmId -and $obj.workerPid) { return [int]$obj.workerPid }
        } catch {}
    }
    if (Test-Path -LiteralPath $claimedFile) {
        try {
            $raw = [System.IO.File]::ReadAllText($claimedFile, [System.Text.Encoding]::UTF8)
            $obj = ConvertFrom-Json $raw
            if ($obj.id -eq $ArmId -and $obj.workerPid) { return [int]$obj.workerPid }
        } catch {}
    }
    return 0
}

function Format-Bytes([long]$bytes) {
    if ($bytes -lt 1024) { return "$bytes B" }
    if ($bytes -lt 1048576) { return "$([Math]::Round($bytes / 1024, 1)) KiB" }
    if ($bytes -lt 1073741824) { return "$([Math]::Round($bytes / 1048576, 2)) MiB" }
    return "$([Math]::Round($bytes / 1073741824, 2)) GiB"
}

$lastState = ""

try {
    while ($true) {
        # Check if receipt exists for THIS EXACT ARM ID
        if (Test-Path -LiteralPath $receiptFile) {
            $receipt = $null
            try {
                $raw = [System.IO.File]::ReadAllText($receiptFile, [System.Text.Encoding]::UTF8)
                $receipt = ConvertFrom-Json $raw
            } catch {}

            if ($receipt -and $receipt.id -eq $ArmId) {
                # Receipt found for exact ArmId!
                # Verify worker process termination using empirical PID evidence
                $workerPid = Get-WorkerPid
                if ($workerPid -le 0) {
                    # Worker PID unknown: cannot verify worker process termination -> NO safe reopen!
                    $Host.UI.RawUI.WindowTitle = '[AVISO] Identidad del trabajador no verificable'
                    Clear-Host
                    Write-Host ''
                    Write-Host '================================================================================' -ForegroundColor Yellow
                    Write-Host '  >>> [AVISO] NO SE PUDO VERIFICAR EL PROCESO TRABAJADOR <<<' -ForegroundColor Yellow
                    Write-Host '================================================================================' -ForegroundColor Yellow
                    Write-Host ''
                    Write-Host '  Se detecto el recibo de mantenimiento, pero no se encontro evidencia del PID'
                    Write-Host '  del proceso trabajador en segundo plano.'
                    Write-Host '  Por seguridad, NO abra OpenCode hasta verificar manualmente que ningun proceso' -ForegroundColor Red
                    Write-Host '  en segundo plano continue accediendo a la base de datos.' -ForegroundColor Red
                    Write-Host ''
                    Write-Host "  Estado del recibo    : $($receipt.status)"
                    if ($receipt.backupPath) {
                        Write-Host "  Copia de seguridad   : $($receipt.backupPath)" -ForegroundColor Cyan
                    }
                    Write-Host ''
                    Write-Host 'Presione [Enter] para cerrar esta ventana de monitorizacion...'
                    [void]$Host.UI.ReadLine()
                    break
                }

                $workerAlive = $true
                while ($workerAlive) {
                    try {
                        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
                        if ($p -and !$p.HasExited) {
                            Clear-Host
                            Write-Host ''
                            Write-Host '================================================================================' -ForegroundColor Cyan
                            Write-Host '  >>> [FINALIZANDO] RECIBO GENERADO - ESPERANDO CIERRE DEL TRABAJADOR <<<' -ForegroundColor Cyan
                            Write-Host '================================================================================' -ForegroundColor Cyan
                            Write-Host "  Cerrando descriptores y finalizando procesos (PID $workerPid)..."
                            Write-Host '  Por favor espere. NO abra OpenCode todavia.' -ForegroundColor Yellow
                            Start-Sleep -Milliseconds 500
                            continue
                        }
                    } catch {}
                    $workerAlive = $false
                }

                # Worker is confirmed terminated!
                Clear-Host
                $completedDateStr = [DateTimeOffset]::FromUnixTimeMilliseconds($receipt.completedAt).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
                
                if ($receipt.status -eq "success") {
                    $Host.UI.RawUI.WindowTitle = '[LISTO] Mantenimiento completado - Ya puede abrir OpenCode'
                    Write-Host ''
                    Write-Host '================================================================================' -ForegroundColor Green
                    Write-Host '  >>> [MANTENIMIENTO FINALIZADO] YA PUEDE VOLVER A ABRIR OPENCODE <<<' -ForegroundColor Green
                    Write-Host '================================================================================' -ForegroundColor Green
                    Write-Host ''
                    Write-Host '  Estado               : EXITO' -ForegroundColor Green
                    Write-Host "  Fecha finalizacion   : $completedDateStr"
                    Write-Host "  Familias eliminadas  : $($receipt.deletedFamilies.Count)"
                    Write-Host "  Sesiones eliminadas  : $($receipt.deletedSessions.Count)"
                    if ($receipt.backupPath) {
                        Write-Host "  Copia de seguridad   : $($receipt.backupPath)" -ForegroundColor Cyan
                    }
                    if ($receipt.spaceFreedBytes -ne $null) {
                        Write-Host "  Espacio liberado BD  : $(Format-Bytes $receipt.spaceFreedBytes)"
                    }
                    if ($receipt.finalSizeBytes -ne $null) {
                        Write-Host "  Tamano final BD      : $(Format-Bytes $receipt.finalSizeBytes)"
                    }
                    Write-Host ''
                    Write-Host '--------------------------------------------------------------------------------' -ForegroundColor Green
                    Write-Host '  LA BASE DE DATOS FUE OPTIMIZADA CORRECTAMENTE Y EL RESPALDO ESTA VERIFICADO.' -ForegroundColor Green
                    Write-Host '  --> YA PUEDE VOLVER A ABRIR OPENCODE CON TOTAL TRANQUILIDAD <--' -ForegroundColor Yellow
                    Write-Host '--------------------------------------------------------------------------------' -ForegroundColor Green
                } elseif ($receipt.status -eq "partial_success") {
                    $Host.UI.RawUI.WindowTitle = '[LISTO CON AVISO] Mantenimiento parcial - Ya puede abrir OpenCode'
                    Write-Host ''
                    Write-Host '================================================================================' -ForegroundColor Yellow
                    Write-Host '  >>> [MANTENIMIENTO PARCIAL] YA PUEDE VOLVER A ABRIR OPENCODE <<<' -ForegroundColor Yellow
                    Write-Host '================================================================================' -ForegroundColor Yellow
                    Write-Host ''
                    Write-Host '  Estado               : EXITO PARCIAL (Borrado completado, aviso en compactacion)' -ForegroundColor Yellow
                    Write-Host "  Fecha finalizacion   : $completedDateStr"
                    Write-Host "  Familias eliminadas  : $($receipt.deletedFamilies.Count)"
                    Write-Host "  Sesiones eliminadas  : $($receipt.deletedSessions.Count)"
                    if ($receipt.backupPath) {
                        Write-Host "  Copia de seguridad   : $($receipt.backupPath)" -ForegroundColor Cyan
                    }
                    if ($receipt.vacuumError) {
                        Write-Host "  Aviso compactacion   : $($receipt.vacuumError)" -ForegroundColor Yellow
                    }
                    Write-Host ''
                    Write-Host '--------------------------------------------------------------------------------' -ForegroundColor Yellow
                    Write-Host '  Las sesiones se eliminaron de forma segura y el respaldo esta integro.' -ForegroundColor Yellow
                    Write-Host '  --> YA PUEDE VOLVER A ABRIR OPENCODE <--' -ForegroundColor Yellow
                    Write-Host '--------------------------------------------------------------------------------' -ForegroundColor Yellow
                } elseif ($receipt.status -eq "expired") {
                    $Host.UI.RawUI.WindowTitle = '[EXPIRADO] Tiempo limite alcanzado'
                    Write-Host ''
                    Write-Host '================================================================================' -ForegroundColor DarkYellow
                    Write-Host '  >>> [TIEMPO EXPIRADO] EL MANTENIMIENTO NO SE EJECUTO <<<' -ForegroundColor DarkYellow
                    Write-Host '================================================================================' -ForegroundColor DarkYellow
                    Write-Host ''
                    Write-Host '  Estado               : EXPIRADO' -ForegroundColor DarkYellow
                    Write-Host '  Motivo               : No se cerro OpenCode dentro del tiempo limite (<5m).'
                    Write-Host '  Resultado en datos   : La base de datos se mantuvo intacta antes de cualquier reclamo.' -ForegroundColor Cyan
                    Write-Host ''
                    Write-Host '--------------------------------------------------------------------------------' -ForegroundColor DarkYellow
                    Write-Host '  --> YA PUEDE VOLVER A ABRIR OPENCODE <--' -ForegroundColor Yellow
                    Write-Host '--------------------------------------------------------------------------------' -ForegroundColor DarkYellow
                } elseif ($receipt.status -eq "cancelled") {
                    $Host.UI.RawUI.WindowTitle = '[CANCELADO] Mantenimiento cancelado'
                    Write-Host ''
                    Write-Host '================================================================================' -ForegroundColor Gray
                    Write-Host '  >>> [CANCELADO] EL MANTENIMIENTO FUE CANCELADO <<<' -ForegroundColor Gray
                    Write-Host '================================================================================' -ForegroundColor Gray
                    Write-Host ''
                    Write-Host '  Estado               : CANCELADO'
                    Write-Host '  Resultado en datos   : Operacion cancelada antes de iniciar modificaciones.' -ForegroundColor Cyan
                    Write-Host ''
                    Write-Host '--------------------------------------------------------------------------------' -ForegroundColor Gray
                    Write-Host '  --> YA PUEDE VOLVER A ABRIR OPENCODE <--' -ForegroundColor Yellow
                    Write-Host '--------------------------------------------------------------------------------' -ForegroundColor Gray
                } else {
                    # Failed or unexpected status: no fake intact, state is uncertain
                    $Host.UI.RawUI.WindowTitle = '[ERROR] Fallo en mantenimiento - Estado incierto'
                    Write-Host ''
                    Write-Host '================================================================================' -ForegroundColor Red
                    Write-Host '  >>> [ERROR] EL MANTENIMIENTO FALLO - ESTADO INCIERTO <<<' -ForegroundColor Red
                    Write-Host '================================================================================' -ForegroundColor Red
                    Write-Host ''
                    Write-Host "  Estado               : FALLIDO ($($receipt.status))" -ForegroundColor Red
                    Write-Host "  Detalle del error    : $($receipt.error)" -ForegroundColor Yellow
                    if ($receipt.backupPath) {
                        Write-Host "  Copia de seguridad   : $($receipt.backupPath)" -ForegroundColor Cyan
                    }
                    Write-Host '  Estado de datos      : INCIERTO. NO se garantiza que la base de datos haya quedado intacta.' -ForegroundColor Red
                    Write-Host '  ADVERTENCIA          : Verifique la integridad o restaure desde el respaldo antes de abrir OpenCode.' -ForegroundColor Yellow
                    Write-Host '================================================================================' -ForegroundColor Red
                }

                Write-Host ''
                Write-Host 'Presione [Enter] para cerrar esta ventana de monitorizacion...'
                [void]$Host.UI.ReadLine()
                break
            }
        }

        # Check if plan was claimed by the worker
        if (Test-Path -LiteralPath $claimedFile) {
            $claimed = $null
            try {
                $raw = [System.IO.File]::ReadAllText($claimedFile, [System.Text.Encoding]::UTF8)
                $claimed = ConvertFrom-Json $raw
            } catch {}

            if ($claimed -and $claimed.id -eq $ArmId) {
                # Check for worker process crash while claimed and no receipt yet generated
                $workerPid = Get-WorkerPid
                if ($workerPid -gt 0) {
                    $wProc = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
                    if (!$wProc -or $wProc.HasExited) {
                        Start-Sleep -Milliseconds 500
                        if (!(Test-Path -LiteralPath $receiptFile)) {
                            $Host.UI.RawUI.WindowTitle = '[ERROR] Proceso trabajador detenido de forma abrupta'
                            Clear-Host
                            Write-Host ''
                            Write-Host '================================================================================' -ForegroundColor Red
                            Write-Host '  >>> [ERROR] EL TRABAJADOR DE MANTENIMIENTO SE DETUVO DE FORMA ABRUPTA <<<' -ForegroundColor Red
                            Write-Host '================================================================================' -ForegroundColor Red
                            Write-Host ''
                            Write-Host "  El proceso de mantenimiento en segundo plano (PID $workerPid) no se encuentra activo" -ForegroundColor Red
                            Write-Host '  y no se genero el recibo final.' -ForegroundColor Red
                            Write-Host '  Estado de datos      : INCIERTO. Se desconoce si la base de datos fue alterada.' -ForegroundColor Red
                            Write-Host '  ADVERTENCIA          : NO abra OpenCode sin verificar el respaldo o la integridad de la base.' -ForegroundColor Yellow
                            Write-Host '================================================================================' -ForegroundColor Red
                            Write-Host ''
                            Write-Host 'Presione [Enter] para cerrar esta ventana de monitorizacion...'
                            [void]$Host.UI.ReadLine()
                            break
                        }
                    }
                }

                if ($lastState -ne "claimed") {
                    $lastState = "claimed"
                    $Host.UI.RawUI.WindowTitle = '[EN PROCESO] No abra OpenCode - Ejecutando limpieza'
                    Clear-Host
                    Write-Host ''
                    Write-Host '================================================================================' -ForegroundColor Yellow
                    Write-Host '  >>> [EN PROCESO] CIERRE DE OPENCODE DETECTADO - NO ABRA OPENCODE <<<' -ForegroundColor Yellow
                    Write-Host '================================================================================' -ForegroundColor Yellow
                    Write-Host ''
                    Write-Host '  Se ha detectado el cierre de OpenCode. El proceso en segundo plano'
                    Write-Host '  ha reclamado el plan y esta ejecutando el mantenimiento de forma segura:'
                    Write-Host ''
                    Write-Host '    1. Verificacion fail-closed de que no existan otras instancias abiertas.'
                    Write-Host '    2. Creacion de copia de seguridad consistente (.sqlite) de la base de datos.'
                    Write-Host '    3. Transaccion exclusiva y eliminacion segura de sesiones seleccionadas.'
                    Write-Host '    4. Comprobacion de integridad fisica de paginas y claves foraneas.'
                    Write-Host '    5. Compactacion VACUUM y punto de control WAL (si aplica).'
                    Write-Host ''
                    Write-Host '  POR FAVOR ESPERE... Operacion en proceso exclusivo.' -ForegroundColor Yellow
                    Write-Host '  NO ABRA OPENCODE hasta que este monitor confirme que el proceso finalizo.' -ForegroundColor Yellow
                    Write-Host '================================================================================' -ForegroundColor Yellow
                }
                Start-Sleep -Milliseconds 500
                continue
            }
        }

        # Owner process check
        $ownerAlive = $false
        if ($OwnerPid -gt 0) {
            try {
                $p = Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue
                if ($p -and !$p.HasExited) { $ownerAlive = $true }
            } catch {}
        }

        $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $remainingSec = [Math]::Max(0, [Math]::Round(($ExpiresAt - $nowMs) / 1000))
        $min = [Math]::Floor($remainingSec / 60)
        $sec = $remainingSec % 60
        $secStr = if ($sec -lt 10) { "0$sec" } else { "$sec" }

        if ($ownerAlive) {
            if ($lastState -ne "waiting") {
                $lastState = "waiting"
                $Host.UI.RawUI.WindowTitle = '[ESPERANDO CIERRE] Cierre OpenCode normalmente'
                Clear-Host
                Write-Host ''
                Write-Host '================================================================================' -ForegroundColor Cyan
                Write-Host '  >>> [ESPERANDO CIERRE] CIERRE TODAS LAS VENTANAS DE OPENCODE <<<' -ForegroundColor Cyan
                Write-Host '================================================================================' -ForegroundColor Cyan
                Write-Host ''
                Write-Host "  OpenCode se encuentra actualmente EN EJECUCION (PID: $OwnerPid)."
                Write-Host ''
                Write-Host '  INSTRUCCIONES:' -ForegroundColor Yellow
                Write-Host '  1. Cierre normalmente todas las ventanas e instancias de OpenCode.' -ForegroundColor Yellow
                Write-Host '  2. NO vuelva a abrir OpenCode hasta que este monitor confirme el fin de la limpieza.' -ForegroundColor Yellow
                Write-Host '  3. Mantenga esta ventana abierta. Si la cierra antes de iniciar la limpieza,' -ForegroundColor Yellow
                Write-Host '     la operacion se cancelara de forma segura.' -ForegroundColor Yellow
                Write-Host ''
                Write-Host '  Detalles del mantenimiento:'
                Write-Host "    - Base de datos   : $DbPath"
                Write-Host "    - Identificador   : $ArmId"
                Write-Host "    - Tiempo restante : ${min}m ${secStr}s (expira si OpenCode no se cierra)"
                Write-Host '================================================================================' -ForegroundColor Cyan
            }
        } else {
            if ($lastState -ne "owner_dead") {
                $lastState = "owner_dead"
                $Host.UI.RawUI.WindowTitle = '[EN PROCESO] Cierre detectado - Iniciando...'
                Clear-Host
                Write-Host ''
                Write-Host '================================================================================' -ForegroundColor Yellow
                Write-Host '  >>> [EN PROCESO] CIERRE DETECTADO - NO ABRA OPENCODE <<<' -ForegroundColor Yellow
                Write-Host '================================================================================' -ForegroundColor Yellow
                Write-Host '  El proceso de OpenCode ha finalizado.'
                Write-Host '  Iniciando comprobaciones previas y reclamacion del plan de mantenimiento...'
                Write-Host '================================================================================' -ForegroundColor Yellow
            }
        }

        Start-Sleep -Milliseconds 500
    }
} finally {
    # Strictly read-only: monitor NEVER mutates or unlinks shared coordination authority files
    # ($armedFile, $claimedFile, $receiptFile). Cancellation on monitor loss is exclusively
    # owned and executed by the background maintenance worker via fail-closed liveness checks.
}
