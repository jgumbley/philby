from syslog_stream import parse_syslog_message


def test_parse_syslog_message_extracts_fields():
    message = "<34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick on /dev/pts/8"
    event = parse_syslog_message(message)

    assert event["pri"] == 34
    assert event["facility"] == 4  # auth
    assert event["severity"] == 2  # critical
    assert event["host"] == "mymachine"
    assert event["tag"] == "su"
    assert event["message"] == "'su root' failed for lonvick on /dev/pts/8"
    assert event["timestamp"] is not None


def test_parse_syslog_message_handles_unparsed_input():
    message = "random line without syslog framing"
    event = parse_syslog_message(message)

    assert event == {"raw": message}
