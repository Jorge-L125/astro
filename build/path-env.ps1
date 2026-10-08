# Añade o quita una carpeta del PATH del usuario. Lo usan el instalador y el desinstalador de Astro.
#
# Se lee y escribe el registro sin expandir las variables: así las entradas como
# %USERPROFILE%\bin se conservan tal cual (con [Environment]::GetEnvironmentVariable se
# expandirían y se perderían).
#
# Con -Current no toca nada: calcula el PATH resultante a partir de ese valor y lo imprime (pruebas).
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Dir,
  [string]$Current
)

function Edit-PathList([string]$path, [string]$dir, [string]$action) {
  $norm = $dir.TrimEnd('\')
  # -ne compara sin distinguir mayúsculas, como Windows con las rutas.
  $parts = @($path -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $norm) })
  if ($action -eq 'add') { $parts += $dir }
  return ($parts -join ';')
}

if ($PSBoundParameters.ContainsKey('Current')) {
  Edit-PathList $Current $Dir $Action
  exit 0
}

$key = Get-Item 'HKCU:\Environment'
$old = [string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
$new = Edit-PathList $old $Dir $Action
if ($new -ne $old) {
  if ($new) {
    Set-ItemProperty 'HKCU:\Environment' -Name 'Path' -Value $new -Type ExpandString
  } else {
    Remove-ItemProperty 'HKCU:\Environment' -Name 'Path'
  }
}
# Avisa a Windows del cambio (WM_SETTINGCHANGE) para que las terminales nuevas vean el PATH nuevo:
# borrar una variable de usuario inexistente no cambia nada pero envía ese aviso.
[Environment]::SetEnvironmentVariable('ASTRO_PATH_REFRESH', $null, 'User')
