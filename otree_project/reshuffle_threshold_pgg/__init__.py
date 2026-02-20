from otree.api import *


doc = """
Reshuffle Threshold Public Goods Game (Stress Module)

Multi-stage repeated game designed to stress synchronization and group dynamics.

Each round:
1) Stage 1 contribution + threshold belief
2) Wait for all players (barrier)
3) Stage 2 revised contribution after aggregate feedback
4) Wait for all players (barrier) and payoff computation

Groups are reshuffled each round.
"""


class C(BaseConstants):
    NAME_IN_URL = 'reshuffle_threshold_pgg'
    PLAYERS_PER_GROUP = 4
    NUM_ROUNDS = 8

    ENDOWMENT = cu(80)
    MULTIPLIER = 2
    THRESHOLD = cu(160)
    COORDINATION_BONUS = cu(20)


class Subsession(BaseSubsession):
    @staticmethod
    def creating_session(subsession: 'Subsession'):
        # Re-randomize groups every round to maximize interaction churn.
        subsession.group_randomly()


class Group(BaseGroup):
    total_contribution_stage1 = models.CurrencyField()
    average_contribution_stage1 = models.CurrencyField()

    total_contribution_stage2 = models.CurrencyField()
    threshold_met = models.BooleanField()

    public_share = models.CurrencyField()


class Player(BasePlayer):
    stage1_contribution = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label='Stage 1: initial contribution (0-80):',
    )
    belief_threshold_prob = models.IntegerField(
        min=0,
        max=100,
        label='Belief: probability (%) your group reaches the threshold this round:',
    )

    stage2_contribution = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label='Stage 2: revised/final contribution (0-80):',
    )

    round_contribution = models.CurrencyField()
    coordination_bonus = models.CurrencyField()
    belief_bonus = models.CurrencyField()


# ── Pages ────────────────────────────────────────────────────


class Introduction(Page):
    """Shown once at round 1."""

    @staticmethod
    def is_displayed(player: Player):
        return player.round_number == 1


class Stage1Decision(Page):
    """Players submit initial contribution and threshold belief."""

    form_model = 'player'
    form_fields = ['stage1_contribution', 'belief_threshold_prob']


class Stage1SyncWaitPage(WaitPage):
    """Barrier after stage-1 submissions."""

    @staticmethod
    def after_all_players_arrive(group: Group):
        players = group.get_players()
        n = len(players)
        group.total_contribution_stage1 = sum(p.stage1_contribution for p in players)
        group.average_contribution_stage1 = group.total_contribution_stage1 / n


class Stage2Decision(Page):
    """Players can revise contribution after seeing stage-1 aggregate feedback."""

    form_model = 'player'
    form_fields = ['stage2_contribution']

    @staticmethod
    def vars_for_template(player: Player):
        group = player.group
        return dict(
            stage1_total=group.total_contribution_stage1,
            stage1_average=group.average_contribution_stage1,
            threshold=C.THRESHOLD,
        )


class Stage2SyncAndResultsWaitPage(WaitPage):
    """Barrier after stage-2 decisions and payoff computation."""

    @staticmethod
    def after_all_players_arrive(group: Group):
        players = group.get_players()
        n = len(players)

        group.total_contribution_stage2 = sum(p.stage2_contribution for p in players)
        group.threshold_met = group.total_contribution_stage2 >= C.THRESHOLD

        group.public_share = (group.total_contribution_stage2 * C.MULTIPLIER) / n

        threshold_outcome = 100 if group.threshold_met else 0
        for p in players:
            p.round_contribution = p.stage2_contribution
            p.coordination_bonus = C.COORDINATION_BONUS if group.threshold_met else cu(0)

            belief_error = abs(p.belief_threshold_prob - threshold_outcome)
            # Piecewise linear belief score in [0,10] points
            belief_score_points = max(0, 10 - belief_error // 10)
            p.belief_bonus = cu(belief_score_points)

            p.payoff = (
                C.ENDOWMENT
                - p.round_contribution
                + group.public_share
                + p.coordination_bonus
                + p.belief_bonus
            )


class Results(Page):
    """Round-level results with rolling history."""

    @staticmethod
    def vars_for_template(player: Player):
        history_rows = []
        for past in player.in_all_rounds():
            if past.round_contribution is None:
                continue
            history_rows.append(dict(
                round_number=past.round_number,
                stage1=past.stage1_contribution,
                stage2=past.stage2_contribution,
                belief=past.belief_threshold_prob,
                bonus=past.coordination_bonus + past.belief_bonus,
                payoff=past.payoff,
            ))

        return dict(
            history_rows=history_rows[-6:],
        )


page_sequence = [
    Introduction,
    Stage1Decision,
    Stage1SyncWaitPage,
    Stage2Decision,
    Stage2SyncAndResultsWaitPage,
    Results,
]
