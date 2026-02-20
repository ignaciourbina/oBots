from otree.api import *


doc = """
Signal + Beliefs + Conditional Cooperation Public Goods Game (Stress Test)

Each round, players:
1) Send a private signal (0-100)
2) Report beliefs about others
3) Submit a full conditional contribution schedule (strategy method)
4) Have realized contributions computed from others' average signal bin
5) Receive payoff from the public good plus belief-accuracy bonuses

Designed as a heavier multi-round app to stress-test automation and UI orchestration.
"""


class C(BaseConstants):
    NAME_IN_URL = 'signal_conditional_pgg'
    PLAYERS_PER_GROUP = 4
    NUM_ROUNDS = 10

    ENDOWMENT = cu(100)
    MULTIPLIER = 2

    # Signal domain and high-signal threshold
    SIGNAL_MIN = 0
    SIGNAL_MAX = 100
    HIGH_SIGNAL_THRESHOLD = 70

    # Belief bonus components
    BELIEF_BONUS_CONTRIB_MAX = cu(12)
    BELIEF_BONUS_SIGNAL_MAX = cu(8)

    # Strategy-method bins for average signal of others
    SIGNAL_BIN_LABELS = {
        1: '0-20',
        2: '21-40',
        3: '41-60',
        4: '61-80',
        5: '81-100',
    }

    SIGNAL_BIN_FIELD_BY_INDEX = {
        1: 'cc_signal_0_20',
        2: 'cc_signal_21_40',
        3: 'cc_signal_41_60',
        4: 'cc_signal_61_80',
        5: 'cc_signal_81_100',
    }


class Subsession(BaseSubsession):
    @staticmethod
    def creating_session(subsession: 'Subsession'):
        # Random rematching each round increases interaction churn and load.
        subsession.group_randomly()


class Group(BaseGroup):
    total_contribution = models.CurrencyField()
    multiplied_total = models.CurrencyField()
    individual_share = models.CurrencyField()
    average_contribution = models.CurrencyField()
    average_signal_group = models.FloatField()


class Player(BasePlayer):
    # Stage 1: signal
    sent_signal = models.IntegerField(
        min=C.SIGNAL_MIN,
        max=C.SIGNAL_MAX,
        label='Choose your signal to send this round (0-100):',
    )

    # Stage 2: beliefs
    belief_avg_others_contribution = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label='Belief: average contribution of the other players (0-100):',
    )
    belief_high_signal_others = models.IntegerField(
        min=0,
        max=C.PLAYERS_PER_GROUP - 1,
        label='Belief: how many of the other players sent a high signal (>= 70)?',
    )

    # Stage 3: strategy method (conditional cooperation schedule)
    cc_signal_0_20 = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label='If average signal of others is 0-20, I contribute:',
    )
    cc_signal_21_40 = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label='If average signal of others is 21-40, I contribute:',
    )
    cc_signal_41_60 = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label='If average signal of others is 41-60, I contribute:',
    )
    cc_signal_61_80 = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label='If average signal of others is 61-80, I contribute:',
    )
    cc_signal_81_100 = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label='If average signal of others is 81-100, I contribute:',
    )

    # Computed outcomes
    avg_signal_others = models.FloatField()
    used_signal_bin = models.IntegerField()
    realized_contribution = models.CurrencyField()

    actual_avg_others_contribution = models.CurrencyField()
    actual_high_signal_others = models.IntegerField()

    belief_bonus_contribution = models.CurrencyField()
    belief_bonus_signal = models.CurrencyField()
    total_belief_bonus = models.CurrencyField()


# ── Helpers ──────────────────────────────────────────────────


def signal_bin(avg_signal: float) -> int:
    if avg_signal <= 20:
        return 1
    if avg_signal <= 40:
        return 2
    if avg_signal <= 60:
        return 3
    if avg_signal <= 80:
        return 4
    return 5


def signal_bin_label(idx: int) -> str:
    return C.SIGNAL_BIN_LABELS[idx]


# ── PAGES ────────────────────────────────────────────────────


class Introduction(Page):
    """Shown once at the start of round 1."""

    @staticmethod
    def is_displayed(player: Player):
        return player.round_number == 1


class SignalStage(Page):
    """Players submit one signal in [0, 100]."""

    form_model = 'player'
    form_fields = ['sent_signal']


class SignalSyncWaitPage(WaitPage):
    """
    Synchronization barrier after signal submission.
    Forces all players to complete Stage 1 before beliefs are shown.
    """

    @staticmethod
    def after_all_players_arrive(group: Group):
        players = group.get_players()
        n = len(players)
        group.average_signal_group = sum(p.sent_signal for p in players) / n


class BeliefStage(Page):
    """Players submit first-order beliefs about others."""

    form_model = 'player'
    form_fields = ['belief_avg_others_contribution', 'belief_high_signal_others']


class BeliefSyncWaitPage(WaitPage):
    """
    Synchronization barrier after belief elicitation.
    Ensures strategy method starts only when everyone submitted beliefs.
    """

    pass


class StrategyStage(Page):
    """Players submit conditional contribution schedule (strategy method)."""

    form_model = 'player'
    form_fields = [
        C.SIGNAL_BIN_FIELD_BY_INDEX[1],
        C.SIGNAL_BIN_FIELD_BY_INDEX[2],
        C.SIGNAL_BIN_FIELD_BY_INDEX[3],
        C.SIGNAL_BIN_FIELD_BY_INDEX[4],
        C.SIGNAL_BIN_FIELD_BY_INDEX[5],
    ]


class RoundComputationWaitPage(WaitPage):
    """Compute realized contributions and payoffs once everyone submitted."""

    @staticmethod
    def after_all_players_arrive(group: Group):
        players = group.get_players()
        n = len(players)

        all_signals = [p.sent_signal for p in players]
        group.average_signal_group = sum(all_signals) / n

        # Realized contributions from strategy schedule
        for p in players:
            others = [q for q in players if q.id_in_group != p.id_in_group]
            others_signals = [q.sent_signal for q in others]
            avg_others_signal = sum(others_signals) / (n - 1)

            p.avg_signal_others = avg_others_signal
            p.used_signal_bin = signal_bin(avg_others_signal)

            chosen_field = C.SIGNAL_BIN_FIELD_BY_INDEX[p.used_signal_bin]
            p.realized_contribution = getattr(p, chosen_field)

        group.total_contribution = sum(p.realized_contribution for p in players)
        group.multiplied_total = group.total_contribution * C.MULTIPLIER
        group.individual_share = group.multiplied_total / n
        group.average_contribution = group.total_contribution / n

        # Belief accuracy bonuses and final payoff
        high_signal_flags = {
            p.id_in_group: 1 if p.sent_signal >= C.HIGH_SIGNAL_THRESHOLD else 0
            for p in players
        }

        for p in players:
            others = [q for q in players if q.id_in_group != p.id_in_group]

            actual_avg_others = sum(q.realized_contribution for q in others) / (n - 1)
            actual_high_others = sum(high_signal_flags[q.id_in_group] for q in others)

            p.actual_avg_others_contribution = actual_avg_others
            p.actual_high_signal_others = actual_high_others

            contrib_error = abs(float(p.belief_avg_others_contribution) - float(actual_avg_others))
            contrib_bonus_points = max(0, int(C.BELIEF_BONUS_CONTRIB_MAX) - round(contrib_error))

            signal_error = abs(p.belief_high_signal_others - actual_high_others)
            signal_bonus_points = max(0, int(C.BELIEF_BONUS_SIGNAL_MAX) - 2 * signal_error)

            p.belief_bonus_contribution = cu(contrib_bonus_points)
            p.belief_bonus_signal = cu(signal_bonus_points)
            p.total_belief_bonus = p.belief_bonus_contribution + p.belief_bonus_signal

            p.payoff = (
                C.ENDOWMENT
                - p.realized_contribution
                + group.individual_share
                + p.total_belief_bonus
            )


class Results(Page):
    """Round feedback + rolling history to create richer UI and state transitions."""

    @staticmethod
    def vars_for_template(player: Player):
        history_rows = []
        for past in player.in_all_rounds():
            if past.realized_contribution is None:
                continue
            history_rows.append(dict(
                round_number=past.round_number,
                sent_signal=past.sent_signal,
                avg_signal_others=round(past.avg_signal_others, 1),
                used_signal_bin=signal_bin_label(past.used_signal_bin),
                contribution=past.realized_contribution,
                belief_bonus=past.total_belief_bonus,
                payoff=past.payoff,
            ))

        return dict(
            used_signal_bin_label=signal_bin_label(player.used_signal_bin),
            history_rows=history_rows[-6:],
        )


page_sequence = [
    Introduction,
    SignalStage,
    SignalSyncWaitPage,
    BeliefStage,
    BeliefSyncWaitPage,
    StrategyStage,
    RoundComputationWaitPage,
    Results,
]
