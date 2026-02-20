from otree.api import *
import random


doc = """
Discrete Coordination Game with Private Signals, Beliefs, and Attention Checks.

Designed as a stress-test app with:
1) Discrete strategy choices (Stag vs Hare)
2) State-dependent payoff matrix
3) Private noisy signals about the underlying state
4) Attention checks on rules comprehension
5) Multiple synchronization barriers and rematching each round
"""


class C(BaseConstants):
    NAME_IN_URL = 'matrix_signal_attention'
    PLAYERS_PER_GROUP = 2
    NUM_ROUNDS = 10

    STATE_GOOD = 'good'
    STATE_BAD = 'bad'

    STRAT_STAG = 'stag'
    STRAT_HARE = 'hare'

    SIGNAL_ACCURACY = 0.75

    STAG_BOTH_GOOD = 14
    STAG_BOTH_BAD = 4
    STAG_AGAINST_HARE = 0
    HARE_AGAINST_STAG = 8
    HARE_BOTH = 6

    BELIEF_BONUS_MAX = 10
    ATTENTION_PENALTY = cu(4)


class Subsession(BaseSubsession):
    @staticmethod
    def creating_session(subsession: 'Subsession'):
        # Rematch each round to increase interaction churn.
        subsession.group_randomly()

        for group in subsession.get_groups():
            group.state = random.choice([C.STATE_GOOD, C.STATE_BAD])

            for player in group.get_players():
                if random.random() < C.SIGNAL_ACCURACY:
                    player.private_signal = group.state
                else:
                    player.private_signal = opposite_state(group.state)


class Group(BaseGroup):
    state = models.StringField()


class Player(BasePlayer):
    private_signal = models.StringField()

    attention_payoff_matrix = models.StringField(
        choices=[
            ['14', '14 points each'],
            ['8', '8 points each'],
            ['6', '6 points each'],
            ['4', '4 points each'],
        ],
        widget=widgets.RadioSelect,
        label='Attention check: In the Good state, if both choose Stag, what payoff does each player get?',
    )
    attention_signal_accuracy = models.StringField(
        choices=[
            ['75', 'The private signal is 75% accurate'],
            ['100', 'The private signal is always accurate'],
            ['50', 'The private signal is random (50%)'],
            ['0', 'The private signal is always wrong'],
        ],
        widget=widgets.RadioSelect,
        label='Attention check: How accurate is your private signal about the state?',
    )
    attention_correct = models.BooleanField()

    belief_partner_stag = models.IntegerField(
        min=0,
        max=100,
        label='Belief: probability (%) your partner will choose Stag this round:',
    )

    action = models.StringField(
        choices=[
            [C.STRAT_STAG, 'Stag'],
            [C.STRAT_HARE, 'Hare'],
        ],
        widget=widgets.RadioSelect,
        label='Choose your action for this round:',
    )

    partner_action = models.StringField()
    base_payoff = models.CurrencyField()
    belief_bonus = models.CurrencyField()
    attention_penalty = models.CurrencyField()


# -- Helpers -----------------------------------------------------------------


def opposite_state(state: str) -> str:
    return C.STATE_BAD if state == C.STATE_GOOD else C.STATE_GOOD


def state_label(state: str | None) -> str:
    if state is None:
        return 'Unknown'
    return 'Good' if state == C.STATE_GOOD else 'Bad'


def action_label(action: str | None) -> str:
    if action is None:
        return '—'
    return 'Stag' if action == C.STRAT_STAG else 'Hare'


def payoff_points(state: str, own_action: str, other_action: str) -> int:
    if own_action == C.STRAT_STAG and other_action == C.STRAT_STAG:
        return C.STAG_BOTH_GOOD if state == C.STATE_GOOD else C.STAG_BOTH_BAD
    if own_action == C.STRAT_STAG and other_action == C.STRAT_HARE:
        return C.STAG_AGAINST_HARE
    if own_action == C.STRAT_HARE and other_action == C.STRAT_STAG:
        return C.HARE_AGAINST_STAG
    return C.HARE_BOTH


def ensure_round_assignments(player: Player) -> None:
    """
    Defensive assignment for cases where a participant reaches a page with
    missing round-level state/signal (e.g., interrupted runs, reconnects).
    """
    group = player.group

    state = group.field_maybe_none('state')
    if state is None:
        state = random.choice([C.STATE_GOOD, C.STATE_BAD])
        group.state = state

    signal = player.field_maybe_none('private_signal')
    if signal is None:
        player.private_signal = (
            state if random.random() < C.SIGNAL_ACCURACY else opposite_state(state)
        )


# -- Pages -------------------------------------------------------------------


class Introduction(Page):
    """Shown once at round 1."""

    @staticmethod
    def is_displayed(player: Player):
        return player.round_number == 1


class MatrixInfo(Page):
    """Shows payoff matrix and player's private signal for this round."""

    @staticmethod
    def vars_for_template(player: Player):
        ensure_round_assignments(player)
        return dict(
            private_signal_label=state_label(player.field_maybe_none('private_signal')),
        )


class AttentionCheck(Page):
    """Non-blocking comprehension checks; wrong answers incur a payoff penalty."""

    form_model = 'player'
    form_fields = ['attention_payoff_matrix', 'attention_signal_accuracy']


class AttentionSyncWaitPage(WaitPage):
    """Barrier after attention checks."""

    pass


class BeliefStage(Page):
    """Belief elicitation about partner's discrete action."""

    form_model = 'player'
    form_fields = ['belief_partner_stag']


class BeliefSyncWaitPage(WaitPage):
    """Barrier after beliefs are submitted."""

    pass


class ActionStage(Page):
    """Players choose one discrete action (Stag/Hare)."""

    form_model = 'player'
    form_fields = ['action']

    @staticmethod
    def vars_for_template(player: Player):
        ensure_round_assignments(player)
        return dict(
            private_signal_label=state_label(player.field_maybe_none('private_signal')),
        )


class ResultsWaitPage(WaitPage):
    """Compute outcomes once both players submit actions."""

    @staticmethod
    def after_all_players_arrive(group: Group):
        if group.field_maybe_none('state') is None:
            group.state = random.choice([C.STATE_GOOD, C.STATE_BAD])

        players = group.get_players()

        for player in players:
            ensure_round_assignments(player)
            partner = [p for p in players if p.id_in_group != player.id_in_group][0]

            own_action = player.field_maybe_none('action') or C.STRAT_HARE
            other_action = partner.field_maybe_none('action') or C.STRAT_HARE
            player.action = own_action
            partner.action = other_action

            player.partner_action = other_action
            player.base_payoff = cu(payoff_points(group.state, own_action, other_action))

            realized_partner_stag = 100 if other_action == C.STRAT_STAG else 0
            belief_error = abs(player.belief_partner_stag - realized_partner_stag)
            belief_points = max(0, C.BELIEF_BONUS_MAX - belief_error // 10)
            player.belief_bonus = cu(belief_points)

            player.attention_correct = (
                player.attention_payoff_matrix == str(C.STAG_BOTH_GOOD)
                and player.attention_signal_accuracy == '75'
            )
            player.attention_penalty = cu(0) if player.attention_correct else C.ATTENTION_PENALTY

            player.payoff = player.base_payoff + player.belief_bonus - player.attention_penalty


class Results(Page):
    """Round feedback and rolling history."""

    @staticmethod
    def vars_for_template(player: Player):
        ensure_round_assignments(player)

        history_rows = []
        for past in player.in_all_rounds():
            base = past.field_maybe_none('base_payoff')
            if base is None:
                continue

            past_signal = past.field_maybe_none('private_signal')
            past_action = past.field_maybe_none('action')
            past_partner_action = past.field_maybe_none('partner_action')

            history_rows.append(
                dict(
                    round_number=past.round_number,
                    signal=state_label(past_signal),
                    action=action_label(past_action),
                    partner_action=action_label(past_partner_action),
                    base_payoff=base,
                    belief_bonus=past.field_maybe_none('belief_bonus') or cu(0),
                    attention_penalty=past.field_maybe_none('attention_penalty') or cu(0),
                    payoff=past.payoff,
                )
            )

        return dict(
            state_label=state_label(player.group.field_maybe_none('state')),
            private_signal_label=state_label(player.field_maybe_none('private_signal')),
            your_action_label=action_label(player.field_maybe_none('action')),
            partner_action_label=action_label(player.field_maybe_none('partner_action')),
            history_rows=history_rows[-6:],
        )


page_sequence = [
    Introduction,
    MatrixInfo,
    AttentionCheck,
    AttentionSyncWaitPage,
    BeliefStage,
    BeliefSyncWaitPage,
    ActionStage,
    ResultsWaitPage,
    Results,
]
