# A stand-in app for checking vmtest by hand in the VM: a window with a classic Win32 menu bar,
# an owned progress window, and an owned message box. Run it inside the VM, for example:
#   vmtest push vmtest\tests\fixtures\menus-and-dialogs.ps1
#   vmtest launch conhost.exe -Arguments "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\vmtest\files\menus-and-dialogs.ps1"
# Launched through conhost like that, the window belongs to a child of the started process, the way
# a PyInstaller one-file build's does.
Add-Type -AssemblyName System.Windows.Forms

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Fixture App'
$form.Width = 500; $form.Height = 300

# MainMenu (not MenuStrip) makes real Win32 menus, like wxPython and most classic apps.
$menu = New-Object System.Windows.Forms.MainMenu
$file = $menu.MenuItems.Add('&File')
$null = $file.MenuItems.Add('&Open...', { $status.Text = 'Open chosen' })
$recent = $file.MenuItems.Add('&Recent')
$null = $recent.MenuItems.Add('one.txt')
$null = $file.MenuItems.Add('-')
$null = $file.MenuItems.Add('E&xit', { $form.Close() })
$process = $menu.MenuItems.Add('&Process')
$null = $process.MenuItems.Add('R&un batch', { Show-Batch })
$option = $process.MenuItems.Add('&Verbose')
$option.Checked = $true
$off = $process.MenuItems.Add('&Unavailable')
$off.Enabled = $false
$form.Menu = $menu

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Ready'; $status.Dock = 'Bottom'
$form.Controls.Add($status)

# A plain Win32 text box, for checking what 'type' and 'keys' really produce.
$box = New-Object System.Windows.Forms.TextBox
$box.Name = 'Notes'; $box.AccessibleName = 'Notes'; $box.Left = 160; $box.Top = 20; $box.Width = 300
$form.Controls.Add($box)

$button = New-Object System.Windows.Forms.Button
$button.Text = 'Run batch'; $button.Left = 20; $button.Top = 20; $button.Width = 120
$button.Add_Click({ Show-Batch })
$form.Controls.Add($button)

# An owned, modeless progress window, then an owned message box on top of it.
function Show-Batch {
    $batch = New-Object System.Windows.Forms.Form
    $batch.Text = 'Batch Complete - Review stats then close'
    $batch.Width = 360; $batch.Height = 160
    $batch.Owner = $form
    $batch.Show()
    $null = [System.Windows.Forms.MessageBox]::Show($batch, 'Some files were skipped.', 'Warning', 'OK', 'Warning')
    $status.Text = 'Warning closed'
}

[System.Windows.Forms.Application]::Run($form)
