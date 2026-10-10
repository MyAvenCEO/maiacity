//! The plan's acceptance scenarios on the Lab (`avendb::scenarios`), each its own test, numbered as in the plan: every
//! check of each must hold. `avendb/spec/AvenDB/Examples.lean` runs them on the Lean model.

use avendb::scenarios::{scenario, SCENARIOS};

/// Play scenario `number` and fail on any check that doesn't hold, naming each.
fn play(number: &str) {
    let s = scenario(number).unwrap_or_else(|| panic!("no scenario {number}"));
    let run = s.run();
    assert!(run.passed(), "scenario {} ({}):\n{}", s.number, s.title, run.failures());
    assert!(!run.checks.is_empty(), "scenario {} checks something", s.number);
}

#[test]
fn scenario_01_alices_vault() {
    play("1");
}

#[test]
fn scenario_01_a_new_device_reaches_every_device() {
    play("1b");
}

#[test]
fn scenario_02_bob_carol_and_dave() {
    play("2");
}

#[test]
fn scenario_03_a_coop_of_two() {
    play("3");
}

#[test]
fn scenario_03_the_coop_key_opens_only_on_owner_devices() {
    play("3b");
}

#[test]
fn scenario_04_a_vaults_own_entries() {
    play("4");
}

#[test]
fn scenario_05_write_and_sync() {
    play("5");
}

#[test]
fn scenario_06_one_document_via_caps() {
    play("6");
}

#[test]
fn scenario_07_public() {
    play("7");
}

#[test]
fn scenario_08_proposals() {
    play("8");
}

#[test]
fn scenario_09_schema_v2() {
    play("9");
}

#[test]
fn scenario_10_revoke_carol() {
    play("10");
}

#[test]
fn scenario_11_lost_iphone() {
    play("11");
}

#[test]
fn scenario_12_bob_leaves() {
    play("12");
}

#[test]
fn scenario_13_offline_conflicts() {
    play("13");
}

#[test]
fn scenario_14_tampering() {
    play("14");
}

#[test]
fn scenario_15_social_todo() {
    play("15");
}

#[test]
fn scenario_16_roles_change_on_one_todo() {
    play("16");
}

#[test]
fn scenario_17_peer_to_peer() {
    play("17");
}

#[test]
fn scenario_18_recovery_after_losing_every_device() {
    play("18");
}

#[test]
fn scenario_18_a_a_backup_passkey_when_the_passkey_is_lost_too() {
    play("18b");
}

#[test]
fn scenario_19_share_every_entry_of_a_type() {
    play("19");
}

#[test]
fn scenario_20_share_by_a_tag() {
    play("20");
}

#[test]
fn scenario_21_a_tag_moves_an_entry_out_of_a_slice() {
    play("21");
}

#[test]
fn scenario_22_asking_for_a_tag() {
    play("22");
}

#[test]
fn scenario_23_creating_through_a_cap() {
    play("23");
}

#[test]
fn scenario_24_a_cap_resting_on_a_cap() {
    play("24");
}

#[test]
fn scenario_25_wide_caps_relays_and_public() {
    play("25");
}

#[test]
fn scenario_26_a_cell_that_comes_back_into_use_moves_on() {
    play("26");
}

#[test]
fn every_scenario_has_its_test() {
    let tested = [
        "1", "1b", "2", "3", "3b", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18",
        "18b", "19", "20", "21", "22", "23", "24", "25", "26",
    ];
    let numbers: Vec<&str> = SCENARIOS.iter().map(|s| s.number).collect();
    assert_eq!(numbers, tested);
}

#[test]
fn a_red_check_names_what_it_found() {
    let mut run = avendb::scenarios::Run::default();
    run.same("two and two", 2 + 2, 5);
    run.check("this holds", true);
    assert!(!run.passed());
    assert_eq!(run.failures(), "two and two: 4, not 5");
}
