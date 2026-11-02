# 이지에이전트 소켓으로 직접 이야기하는 부품 (agent_switch.ps1 이 불러 씀). 브라우저 없이 목록 조회·시험 출력 확인
if (-not ('MkwTrustAll' -as [type])) {
  Add-Type -TypeDefinition @'
using System.Net.Security;
public static class MkwTrustAll {
  public static void On() { System.Net.ServicePointManager.ServerCertificateValidationCallback = delegate { return true; }; }
}
'@
}
function Open-AgentSocket {
  [MkwTrustAll]::On()   # 에이전트 자체 인증서. 이 컴퓨터 안(127.0.0.1) 연결에만 씀
  foreach ($url in 'wss://127.0.0.1:45271/', 'ws://127.0.0.1:45271/') {
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    try {
      if ($ws.ConnectAsync([uri]$url, [Threading.CancellationToken]::None).Wait(5000) -and $ws.State -eq 'Open') { return @{ ws = $ws; url = $url } }
    } catch {}
    $ws.Dispose()
  }
  return $null
}
function Send-Agent($ws, [string]$text) {
  $b = [Text.Encoding]::UTF8.GetBytes($text)
  [void]$ws.SendAsync((New-Object ArraySegment[byte] -ArgumentList @(, $b)), 'Text', $true, [Threading.CancellationToken]::None).Wait(5000)
}
# 정해진 초 안에 test 를 만족하는 메시지를 기다림. 못 받으면 $null
function Read-Agent($ws, [int]$seconds, [scriptblock]$test) {
  $end = (Get-Date).AddSeconds($seconds)
  $buf = New-Object byte[] 65536
  while ((Get-Date) -lt $end -and $ws.State -eq 'Open') {
    $ms = New-Object IO.MemoryStream
    do {
      $task = $ws.ReceiveAsync((New-Object ArraySegment[byte] -ArgumentList @(, $buf)), [Threading.CancellationToken]::None)
      while (-not $task.Wait(500)) { if ((Get-Date) -ge $end) { return $null } }
      $ms.Write($buf, 0, $task.Result.Count)
    } while (-not $task.Result.EndOfMessage)
    $msg = [Text.Encoding]::UTF8.GetString($ms.ToArray())
    if (& $test $msg) { return $msg }
  }
  return $null
}
