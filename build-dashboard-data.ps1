$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$invoicePath = Join-Path $workspace 'invoices.csv'
$contactsPath = Join-Path $workspace 'CP emails.csv'
$outputCsvPath = Join-Path $workspace 'invoices_processed.csv'
$outputJsPath = Join-Path $workspace 'dashboard-data.js'

function Convert-ToDecimal {
    param([object]$Value)

    $number = 0D
    [void][decimal]::TryParse(
        [string]$Value,
        [Globalization.NumberStyles]::Any,
        [Globalization.CultureInfo]::InvariantCulture,
        [ref]$number
    )
    return $number
}

function Convert-ToDate {
    param([object]$Value)

    $text = [string]$Value
    $formats = @(
        'M/d/yyyy H:mm',
        'M/d/yyyy HH:mm',
        'MM/dd/yyyy H:mm',
        'MM/dd/yyyy HH:mm',
        'yyyy-MM-dd H:mm',
        'yyyy-MM-dd HH:mm'
    )
    $date = [datetime]::MinValue
    if ([datetime]::TryParseExact(
        $text,
        $formats,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal,
        [ref]$date
    )) {
        return $date
    }

    return [datetime]::Parse($text, [Globalization.CultureInfo]::InvariantCulture)
}

function Get-TotalBeforeGst {
    param(
        [object]$Row,
        [string]$Organization,
        [decimal]$Total,
        [decimal]$Tax
    )

    $transactionDate = Convert-ToDate $Row.'Date (UTC)'
    $overrideStart = [datetime]'2022-02-12'
    $overrideEnd = [datetime]'2024-06-11 23:59:59'

    if ($Organization -eq 'focusu' -and $transactionDate -ge $overrideStart -and $transactionDate -le $overrideEnd) {
        return 0D
    }

    return $Total - $Tax
}

$contacts = Import-Csv -LiteralPath $contactsPath
$contactMap = @{}
$contactDomainMap = @{}

foreach ($contact in $contacts) {
    $email = $contact.'Contact Emails '
    if (-not $email) { $email = $contact.'Contact Emails' }
    if (-not $email) { $email = $contact.email }
    if (-not $email) { $email = $contact.Email }

    $organization = $contact.'CP name'
    if (-not $organization) { $organization = $contact.'CP Name' }
    if (-not $organization) { $organization = $contact.Organization }

    if ($email -and $organization -and $organization.Trim()) {
        $key = $email.Trim().ToLowerInvariant()
        if ($key.Contains('@')) {
            $contactMap[$key] = $organization.Trim()
        } else {
            $contactDomainMap[$key] = $organization.Trim()
        }
    }
}

$invoices = Import-Csv -LiteralPath $invoicePath
$positiveSubtotalCount = 0
$processed = foreach ($row in $invoices) {
    $subtotal = Convert-ToDecimal $row.Subtotal
    if ($subtotal -le 0) { continue }
    $positiveSubtotalCount++

    $customerEmail = [string]$row.'Customer Email'
    if (-not $customerEmail) { continue }

    $key = $customerEmail.Trim().ToLowerInvariant()
    $domain = ($key -split '@')[-1]
    if ($contactMap.ContainsKey($key)) {
        $organization = $contactMap[$key]
    } elseif ($contactDomainMap.ContainsKey($domain)) {
        $organization = $contactDomainMap[$domain]
    } else {
        continue
    }

    if (-not $organization -or -not $organization.Trim()) { continue }

    $tax = Convert-ToDecimal $row.Tax
    $total = Convert-ToDecimal $row.Total
    $ending = Convert-ToDecimal $row.'Ending Balance'
    $starting = Convert-ToDecimal $row.'Starting Balance'
    $totalBeforeGst = Get-TotalBeforeGst -Row $row -Organization $organization -Total $total -Tax $tax

    [pscustomobject][ordered]@{
        id = $row.id
        'Date (UTC)' = $row.'Date (UTC)'
        'Ending Balance' = $row.'Ending Balance'
        'Starting Balance' = $row.'Starting Balance'
        'Credits Usage' = ($ending - $starting).ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
        Subtotal = $row.Subtotal
        'Total Discount Amount' = $row.'Total Discount Amount'
        'Applied Coupons' = $row.'Applied Coupons'
        Tax = $row.Tax
        'Total Before GST' = $totalBeforeGst.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
        Total = $row.Total
        'Customer Email' = $row.'Customer Email'
        Organization = $organization
        Platform = 'Stripe'
        'Amount Paid' = $row.'Amount Paid'
        Status = $row.Status
    }
}

$processedRows = @($processed)
$processedRows | Export-Csv -LiteralPath $outputCsvPath -NoTypeInformation -Encoding UTF8

$payload = [pscustomobject]@{
    generatedAt = (Get-Date).ToString('s')
    source = [pscustomobject]@{
        invoiceRows = $invoices.Count
        positiveSubtotalRows = $positiveSubtotalCount
        contactRows = $contacts.Count
        matchedRows = $processedRows.Count
    }
    rows = $processedRows
}

'window.DASHBOARD_DATA = ' + ($payload | ConvertTo-Json -Depth 6) + ';' |
    Set-Content -LiteralPath $outputJsPath -Encoding UTF8

$payload.source | ConvertTo-Json
